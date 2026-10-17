from flask import Flask, request, jsonify
from ultralytics import YOLO
from PIL import Image
import io, time, os

app = Flask(__name__)

print("Đang tải model YOLOv8...")
# Dùng file best.onnx (đã có sẵn trong thư mục)
model = YOLO('best.onnx') 
print("Tải model thành công!")

@app.route('/', methods=['GET'])
def home():
    return jsonify({"status": "YOLOv8 API is running"})

@app.route('/predict', methods=['POST'])
def predict():
    t_start = time.time()
    if 'image' not in request.files:
        return jsonify({'error': 'No image provided'}), 400
    
    file = request.files['image']
    img = Image.open(io.BytesIO(file.read())).convert('RGB')
    
    t_infer_start = time.time()
    # Thư viện tự động xử lý resize, NMS, vẽ box
    results = model.predict(img, conf=0.4, verbose=False)
    t_infer_end = time.time()
    
    detections = []
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
    
    return jsonify({
        'detections': detections,
        'inference_ms': (t_infer_end - t_infer_start) * 1000
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))