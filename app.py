import eventlet
eventlet.monkey_patch() # Bắt buộc phải gọi ở đầu file để SocketIO hoạt động

import os
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit
from ultralytics import YOLO
from PIL import Image
import io, time, datetime, uuid, psycopg2, re
from dotenv import load_dotenv
import cv2
import requests
import torch

# Ép AI chạy 1 luồng CPU để không tranh chấp tài nguyên với Web
torch.set_num_threads(1)

load_dotenv()

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Nạp model
model = YOLO('best.onnx', task='detect') 

IMAGE_DIR = 'static/violations'
os.makedirs(IMAGE_DIR, exist_ok=True)

TELEGRAM_BOT_TOKEN = "8896266831:AAEFgQhF9omfO4SqytkNROM2pfy0lcQeAos"
TELEGRAM_CHAT_ID = "6473814193"

last_violation_time = 0

def get_db_connection():
    return psycopg2.connect(os.getenv("DATABASE_URL"))

def init_db():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS history
                 (id SERIAL PRIMARY KEY, time TEXT, label TEXT, image_url TEXT)''')
    conn.commit()
    c.close()
    conn.close()

init_db()

def send_telegram_async(msg, filepath, caption):
    try:
        url_msg = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        requests.post(url_msg, data={"chat_id": TELEGRAM_CHAT_ID, "text": msg, "parse_mode": "HTML"})
        time.sleep(0.5) 
        url_photo = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendPhoto"
        with open(filepath, 'rb') as f:
            requests.post(url_photo, data={"chat_id": TELEGRAM_CHAT_ID, "caption": caption}, files={"photo": f})
    except Exception as e:
        print("Lỗi gửi Telegram:", e)

@app.route('/', methods=['GET'])
def home():
    return render_template('index.html')

# --- WEBSOCKET ENDPOINT ---
@socketio.on('image_frame')
def handle_image_frame(data):
    global last_violation_time

    img_bytes = io.BytesIO(data)
    img = Image.open(img_bytes).convert('RGB')
    
    t_infer_start = time.time()
    # SỬA IMGSZ VỀ 320 ĐỂ TỐI ƯU TỐC ĐỘ CHO T3.MICRO
    results = model.predict(img, conf=0.6, iou=0.4, agnostic_nms=True, imgsz=640, verbose=False)
    t_infer_end = time.time()
    
    detections = []
    count_correct, count_wrong, count_incorrect = 0, 0, 0
    
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            label = model.names[cls_id]
            
            detections.append({'label': label, 'confidence': conf, 'box': [x1, y1, x2, y2]})
            
            if label == 'with_mask': count_correct += 1
            elif label == 'without_mask': count_wrong += 1
            elif label == 'mask_weared_incorrect': count_incorrect += 1
    
    details = []
    if count_correct > 0: details.append(f"{count_correct} Đúng")
    if count_wrong > 0: details.append(f"{count_wrong} Không đeo")
    if count_incorrect > 0: details.append(f"{count_incorrect} Đeo sai")
    label_text = ", ".join(details) if details else "Không có người"
    
    current_time = time.time()
    is_saved = False 
    
    if (count_wrong > 0 or count_incorrect > 0) and (current_time - last_violation_time > 10):
        last_violation_time = current_time
        
        annotated_img = results[0].plot() 
        annotated_img_rgb = cv2.cvtColor(annotated_img, cv2.COLOR_BGR2RGB)
        final_img = Image.fromarray(annotated_img_rgb)

        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(IMAGE_DIR, filename)
        final_img.save(filepath, format="JPEG", quality=80) 
        
        vn_time = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7)))
        time_str = vn_time.strftime("%H:%M:%S %d/%m/%Y")
        
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("INSERT INTO history (time, label, image_url) VALUES (%s, %s, %s)",
                  (time_str, label_text, f"/static/violations/{filename}"))
        conn.commit()
        c.close()
        conn.close()
        
        is_saved = True 

        total_violations = count_wrong + count_incorrect
        msg = f"🚨 <b>CẢNH BÁO VI PHẠM KHUÔN MẶT</b> 🚨\n"
        msg += f"🕒 Thời gian: {time_str}\n"
        msg += f"----------------------------\n"
        msg += f"✅ Số người đeo đúng: {count_correct}\n"
        msg += f"❌ Số người không đeo: {count_wrong}\n"
        msg += f"⚠️ Số người đeo sai: {count_incorrect}\n"
        msg += f"----------------------------\n"
        msg += f"🔥 <b>TỔNG SỐ VI PHẠM: {total_violations}</b>"
        
        caption = f"Vi phạm: {total_violations} người (Không đeo: {count_wrong}, Đeo sai: {count_incorrect})"
        
        # Dùng background_task của SocketIO để không chặn luồng WebSocket
        socketio.start_background_task(send_telegram_async, msg, filepath, caption)

    # Gửi kết quả lại cho Client
    emit('result', {
        'detections': detections,
        'label_text': label_text,
        'count_correct': count_correct,
        'count_wrong': count_wrong,
        'count_incorrect': count_incorrect,
        'inference_ms': (t_infer_end - t_infer_start) * 1000,
        'is_saved': is_saved
    })

@app.route('/api/history', methods=['GET'])
def get_history():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT time, label, image_url FROM history ORDER BY id DESC LIMIT 15")
    rows = c.fetchall()
    conn.close()
    history = [{'time': r[0], 'label': r[1], 'image_url': r[2]} for r in rows]
    return jsonify(history)

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT label FROM history")
    rows = c.fetchall()
    conn.close()
    
    total_correct, total_wrong, total_incorrect = 0, 0, 0
    
    for row in rows:
        label = row[0]
        m_c = re.search(r'(\d+) Đúng', label)
        if m_c: total_correct += int(m_c.group(1))
        m_w = re.search(r'(\d+) Không đeo', label)
        if m_w: total_wrong += int(m_w.group(1))
        m_i = re.search(r'(\d+) Đeo sai', label)
        if m_i: total_incorrect += int(m_i.group(1))
        
    return jsonify({
        'correct': total_correct,
        'wrong': total_wrong,
        'incorrect': total_incorrect
    })

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))