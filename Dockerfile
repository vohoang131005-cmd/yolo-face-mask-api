# Sử dụng image Python chính thức
FROM python:3.11-slim

# Đặt thư mục làm việc
WORKDIR /code

# Sao chép và cài đặt các thư viện
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Sao chép toàn bộ mã nguồn
COPY . .

# Hugging Face Spaces yêu cầu ứng dụng chạy trên cổng 7860
EXPOSE 7860

# Lệnh khởi chạy ứng dụng Flask
CMD ["gunicorn", "-b", "0.0.0.0:7860", "app:app"]