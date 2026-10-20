FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Cài PyTorch bản CPU (siêu nhẹ)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Cài các thư viện còn lại
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000
# CHẠY TRỰC TIẾP BẰNG PYTHON (SOCKETIO SẼ TỰ KHỞI CHẠY WEBSERVER)
CMD ["python", "app.py"]