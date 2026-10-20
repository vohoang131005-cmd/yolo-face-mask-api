const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('startBtn');
const historyTableBody = document.getElementById('historyTableBody');

const totalCount = document.getElementById('total-count');
const correctCount = document.getElementById('correct-count');
const wrongCount = document.getElementById('wrong-count');
const incorrectCount = document.getElementById('incorrect-count');
const latencyBadge = document.getElementById('latency-badge');

let isRunning = false;
let stream = null;
let isProcessing = false;
let processTimeout = null;

// KHỞI TẠO SOCKET.IO
const socket = io();

socket.on('connect', () => {
    console.log("Đã kết nối WebSocket với Server");
});

// NHẬN KẾT QUẢ TỪ SERVER (Bất đồng bộ)
socket.on('result', (data) => {
    clearTimeout(processTimeout); // Hủy bộ đếm chống treo
    isProcessing = false; // Mở khóa để gửi frame tiếp theo

    const t1 = performance.now();
    const roundTripTime = t1 - window.t_send;
    
    totalCount.innerText = data.detections.length;
    correctCount.innerText = data.count_correct;
    wrongCount.innerText = data.count_wrong;
    incorrectCount.innerText = data.count_incorrect;

    latencyBadge.innerHTML = `<i class="fa-solid fa-bolt text-warning"></i> Cloud: ${data.inference_ms.toFixed(0)}ms | Round-trip: ${roundTripTime.toFixed(0)}ms`;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Tỷ lệ scale: Ảnh gửi đi là 640x480
    const scaleX = canvas.width / 640;
    const scaleY = canvas.height / 480;

    data.detections.forEach(det => {
        let [x1, y1, x2, y2] = det.box;
        x1 *= scaleX; x2 *= scaleX;
        y1 *= scaleY; y2 *= scaleY;

        let color = '#4ade80'; // Xanh (Đúng)
        if (det.label === 'without_mask') color = '#f87171'; // Đỏ (Không đeo)
        if (det.label === 'mask_weared_incorrect') color = '#fbbf24'; // Vàng (Đeo sai)

        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        let text = `${det.label} (${(det.confidence*100).toFixed(0)}%)`;
        ctx.font = "bold 16px Inter";
        let textWidth = ctx.measureText(text).width;

        ctx.fillStyle = color;
        ctx.fillRect(x1, y1 - 24, textWidth + 10, 24);
        
        ctx.fillStyle = '#000';
        ctx.textAlign = "left"; 
        ctx.fillText(text, x1 + 5, y1 - 6);
    });

    if (data.is_saved) {
        loadHistory();
        updateChart();
    }
});

// Các hàm xử lý biểu đồ và menu
const menuItems = document.querySelectorAll('.sidebar-menu li');
menuItems.forEach(item => {
    item.addEventListener('click', function() {
        menuItems.forEach(i => i.classList.remove('active'));
        this.classList.add('active');
    });
});

let myChart = null;
function initChart() {
    const ctxChart = document.getElementById('statsChart').getContext('2d');
    myChart = new Chart(ctxChart, {
        type: 'doughnut',
        data: {
            labels: ['Đeo đúng', 'Không đeo', 'Đeo sai'],
            datasets: [{ data: [0, 0, 0], backgroundColor: ['#4ade80', '#f87171', '#fbbf24'], borderWidth: 0, hoverOffset: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { color: '#e2e8f0', padding: 20, font: { size: 13 } } } } }
    });
}

async function updateChart() {
    try {
        const response = await fetch('/api/stats');
        const data = await response.json();
        if (myChart) {
            myChart.data.datasets[0].data = [data.correct, data.wrong, data.incorrect];
            myChart.update();
        }
    } catch (e) { console.log("Lỗi tải thống kê"); }
}

setInterval(() => { updateChart(); loadHistory(); }, 10000); 

// Xử lý Bật/Tắt Camera
startBtn.addEventListener('click', async () => {
    if (!isRunning) {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            video.srcObject = stream;
            isRunning = true;
            startBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Dừng Camera';
            startBtn.classList.replace('btn-primary', 'btn-danger');
            
            video.onloadedmetadata = () => {
                canvas.width = video.clientWidth;
                canvas.height = video.clientHeight;
                processFrame();
            }
        } catch (err) {
            alert("Không thể mở Camera. Vui lòng cấp quyền!");
        }
    } else {
        stream.getTracks().forEach(track => track.stop());
        isRunning = false;
        startBtn.innerHTML = '<i class="fa-solid fa-video"></i> Bật Camera';
        startBtn.classList.replace('btn-danger', 'btn-primary');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        latencyBadge.innerHTML = '<i class="fa-solid fa-bolt text-warning"></i> Chưa kết nối';
    }
});

// Vòng lặp gửi Frame qua WebSocket
function processFrame() {
    if (!isRunning) return;
    
    if (isProcessing) {
        requestAnimationFrame(processFrame);
        return;
    }

    if (video.videoWidth > 0) {
        isProcessing = true;
        
        // Nếu quá 2.5s không phản hồi, tự động mở khóa để không bị đơ
        processTimeout = setTimeout(() => {
            isProcessing = false;
            latencyBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-danger"></i> Timeout!';
        }, 2500);

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 640;
        tempCanvas.height = 480;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0, 640, 480);
        
        tempCanvas.toBlob((blob) => {
            if (blob && socket.connected) {
                window.t_send = performance.now();
                socket.emit('image_frame', blob); // Gửi qua WebSocket
            } else {
                clearTimeout(processTimeout);
                isProcessing = false;
            }
        }, 'image/jpeg', 0.7); 
    }
    
    requestAnimationFrame(processFrame);
}

async function loadHistory() {
    try {
        const response = await fetch('/api/history');
        const data = await response.json();
        
        if (data.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="4" class="text-light py-4">Chưa có dữ liệu vi phạm...</td></tr>';
            return;
        }

        historyTableBody.innerHTML = '';
        data.forEach(item => {
            let badgeText = "Vi phạm";
            let badgeColor = "bg-danger";

            if (item.label.includes("Đeo sai") && !item.label.includes("Không đeo")) {
                badgeText = "Đeo sai"; badgeColor = "bg-warning text-dark";
            } else if (item.label.includes("Không đeo") && !item.label.includes("Đeo sai")) {
                badgeText = "Không đeo"; badgeColor = "bg-danger";
            } else if (item.label.includes("Không đeo") && item.label.includes("Đeo sai")) {
                badgeText = "Hỗn hợp"; badgeColor = "bg-danger";
            }

            historyTableBody.innerHTML += `
                <tr>
                    <td class="fw-bold text-light">${item.time}</td>
                    <td><img src="${item.image_url}?t=${Date.now()}" class="table-img" alt="Vi phạm"></td>
                    <td><span class="badge ${badgeColor} px-3 py-2 fs-6">${badgeText}</span></td>
                    <td class="text-start text-light fs-6">${item.label}</td>
                </tr>
            `;
        });
    } catch (e) { console.log("Lỗi tải lịch sử"); }
}

initChart();
updateChart();
loadHistory();