from flask import Flask, request, jsonify, render_template
from ultralytics import YOLO
from PIL import Image
import io, time, os, base64, datetime

app = Flask(__name__)

print("Đang tải model YOLOv8...")
# Dùng file best.onnx (đã có sẵn trong thư mục)
model = YOLO('best.onnx') 
print("Tải model thành công!")

# "Database" lưu lịch sử tạm thời trên RAM (Reset khi khởi động lại server)
violation_history = []

@app.route('/', methods=['GET'])
def home():
    # Trả về giao diện HTML
    return render_template('index.html')

@app.route('/predict', methods=['POST'])
def predict():
    t_start = time.time()
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    
    file = request.files['image']
    img_bytes = file.read()
    img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    
    t_infer_start = time.time()
    results = model.predict(img, conf=0.4, verbose=False)
    t_infer_end = time.time()
    
    detections = []
    has_violation = False
    
    for r in results:
        for box in r.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            label = model.names[cls_id]
            
            detections.append({
                'label': label,
                'confidence': conf,
                'box': [x1, y1, x2, y2]
            })
            
            # Nếu phát hiện không đeo hoặc đeo sai -> Đánh dấu vi phạm
            if label in ['without_mask', 'mask_weared_incorrect']:
                has_violation = True
    
    # LƯU LỊCH SỬ VI PHẠM (Nếu có)
    if has_violation:
        # Ép ảnh về JPG và mã hóa Base64 để gửi lên Web hiển thị
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG")
        img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
        
        current_time = datetime.datetime.now().strftime("%H:%M:%S")
        
        # Lưu vào database tạm
        violation_history.insert(0, {
            'time': current_time,
            'label': 'Phát hiện người vi phạm',
            'image': img_base64
        })
        
        # Chỉ giữ lại 10 bản ghi gần nhất để không tràn RAM
        if len(violation_history) > 10:
            violation_history.pop()

    return jsonify({
        'detections': detections,
        'inference_ms': (t_infer_end - t_infer_start) * 1000
    })

@app.route('/api/history', methods=['GET'])
def get_history():
    # Trả về danh sách lịch sử cho Frontend
    return jsonify(violation_history)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))