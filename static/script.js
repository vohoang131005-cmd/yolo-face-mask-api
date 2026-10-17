const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stats = document.getElementById('stats');
const historyList = document.getElementById('historyList');

let isRunning = false;
let stream = null;
let isProcessing = false; // Cờ chặn gửi request liên tục

// Hàm bật/tắt Camera
startBtn.addEventListener('click', async () => {
    if (!isRunning) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            isRunning = true;
            startBtn.innerText = "Đang chạy (Bấm để dừng)";
            startBtn.classList.replace('btn-success', 'btn-danger');
            
            // Đợi video load xong mới bắt đầu gửi ảnh
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                processFrame();
            }
        } catch (err) {
            alert("Không thể mở Camera. Vui lòng cấp quyền!");
            console.error(err);
        }
    } else {
        stream.getTracks().forEach(track => track.stop());
        isRunning = false;
        startBtn.innerText = "Bật Camera";
        startBtn.classList.replace('btn-danger', 'btn-success');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
});

// Vòng lặp gửi ảnh lên Server
async function processFrame() {
    if (!isRunning) return;

    // Nếu đang đợi Server trả lời thì không gửi tiếp (tránh nghẽn mạng)
    if (!isProcessing && video.videoWidth > 0) {
        isProcessing = true;

        // Chụp ảnh từ Webcam
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = video.videoWidth;
        tempCanvas.height = video.videoHeight;
        tempCanvas.getContext('2d').drawImage(video, 0, 0);
        
        tempCanvas.toBlob(async (blob) => {
            const formData = new FormData();
            formData.append('image', blob, 'frame.jpg');

            const t0 = performance.now();
            try {
                // Gửi API
                const response = await fetch('/predict', { method: 'POST', body: formData });
                const data = await response.json();
                const t1 = performance.now();

                // Xóa khung cũ
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                
                // Vẽ khung mới
                data.detections.forEach(det => {
                    const [x1, y1, x2, y2] = det.box;
                    let color = '#00ff00'; // Xanh (Đeo đúng)
                    if (det.label === 'without_mask') color = '#ff0000'; // Đỏ
                    if (det.label === 'mask_weared_incorrect') color = '#ffa500'; // Cam

                    ctx.strokeStyle = color;
                    ctx.lineWidth = 4;
                    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

                    ctx.fillStyle = color;
                    ctx.font = "bold 18px Arial";
                    ctx.fillText(`${det.label} (${(det.confidence*100).toFixed(0)}%)`, x1, y1 - 8);
                });

                // Cập nhật thông số
                const count = data.detections.length;
                stats.innerText = `Nguoi: ${count} | Cloud: ${data.inference_ms.toFixed(0)}ms | Round-trip: ${(t1-t0).toFixed(0)}ms`;
                
                // Nếu có người vi phạm thì load lại lịch sử
                if (data.detections.some(d => d.label !== 'with_mask')) {
                    loadHistory();
                }

            } catch (e) {
                console.error("Lỗi gửi API:", e);
                stats.innerText = "Lỗi kết nối Server!";
            }
            
            isProcessing = false; // Mở khóa cho frame tiếp theo
        }, 'image/jpeg', 0.7);
    }
    
    // Lặp lại sau 1 giây (để tránh spam server)
    setTimeout(processFrame, 1000);
}

// Hàm tải lịch sử từ Database
async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const data = await response.json();
        
        if (data.length === 0) return;

        historyList.innerHTML = '';
        data.forEach(item => {
            historyList.innerHTML += `
                <div class="history-item">
                    <strong>${item.time}</strong> - Phát hiện ${item.label}
                    <img src="data:image/jpeg;base64,${item.image}">
                </div>
            `;
        });
    } catch (e) {
        console.log("Lỗi tải lịch sử");
    }
}

// Tải lịch sử lần đầu khi mở trang
loadHistory();