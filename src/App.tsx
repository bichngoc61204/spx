import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CheckCircle2, AlertTriangle, Video, Upload, RefreshCw, Edit3, Film, Check, Trash2, PackageCheck, Sparkles } from 'lucide-react';

const GOOGLE_SCRIPT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzQquNH2KXJhk6AsXx8WKIOKAR-54frJXNR7X0_wbPAP9TCd-URwWwomusEmr1-ZLVcXg/exec"; 

const REASON_OPTIONS = [
  "Bể vỡ / Móp méo",
  "Rách mã / Mờ mã vạch",
  "Ướt / Hỏng do thời tiết",
  "Thiếu hàng / Trống hàng",
  "Sai thông tin người nhận",
  "Khác"
];

const DEFAULT_PREFIX = "SPXVN";

export default function App() {
  const [trackingCode, setTrackingCode] = useState<string>('');
  const [isManualInput, setIsManualInput] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>(DEFAULT_PREFIX);
  const [isScanning, setIsScanning] = useState<boolean>(true);
  
  const [reason, setReason] = useState<string>(REASON_OPTIONS[0]);
  const [description, setDescription] = useState<string>('');
  
  const [recording, setRecording] = useState<boolean>(false);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (isScanning && !trackingCode) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
  }, [isScanning, trackingCode]);

  const startScanner = async () => {
    try {
      const element = document.getElementById("reader");
      if (!element) return;

      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode("reader");
      }

      if (scannerRef.current.isScanning) return;

      const config = {
        fps: 25,
        qrbox: { width: 260, height: 160 },
        aspectRatio: 1.0,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.UPC_A
        ],
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true
        }
      };

      await scannerRef.current.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          let cleanedCode = decodedText.trim().toUpperCase();
          if (cleanedCode) {
            if (navigator.vibrate) navigator.vibrate(200);
            setTrackingCode(cleanedCode);
            setIsScanning(false);
          }
        },
        () => {}
      );
    } catch (err) {
      console.error("Lỗi Camera Scanner:", err);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (err) {
        console.error("Lỗi dừng scanner:", err);
      }
    }
  };

  const startRecording = async () => {
    videoChunksRef.current = [];
    setVideoBlob(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { max: 20 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        await videoPreviewRef.current.play();
      }

      let selectedMimeType = 'video/webm;codecs=vp8';
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        selectedMimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
        selectedMimeType = 'video/webm;codecs=vp8';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        selectedMimeType = 'video/webm';
      }

      const options: MediaRecorderOptions = {
        mimeType: selectedMimeType,
        videoBitsPerSecond: 600000 
      };

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          videoChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const finalMimeType = selectedMimeType || 'video/mp4';
        const blob = new Blob(videoChunksRef.current, { type: finalMimeType });
        
        setVideoBlob(blob);

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }
      };

      mediaRecorder.start(500);
      setRecording(true);
    } catch (err) {
      alert("Không thể bật camera quay video: " + err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64String = result.substring(result.indexOf(',') + 1);
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  };

  const handleSubmit = async () => {
    if (!trackingCode) {
      alert("Vui lòng quét hoặc nhập mã vận đơn!");
      return;
    }
    if (!videoBlob) {
      alert("Vui lòng quay video minh chứng!");
      return;
    }

    setIsUploading(true);

    try {
      const base64Video = await blobToBase64(videoBlob);
      const payload = {
        trackingCode: trackingCode,
        reason: reason,
        description: description,
        videoFileName: `${trackingCode}.mp4`,
        videoBase64: base64Video,
        mimeType: videoBlob.type || "video/mp4",
        status: "pending"
      };

      const response = await fetch(GOOGLE_SCRIPT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();

      if (resData.result === 'success') {
        setUploadSuccess(true);
      } else {
        alert("Lỗi upload từ server: " + resData.error);
      }
    } catch (err) {
      console.error(err);
      alert("Lỗi kết nối khi tải lên. Đảm bảo video ngắn để tránh quá dung lượng!");
    } finally {
      setIsUploading(false);
    }
  };

  const handleReset = () => {
    setTrackingCode('');
    setIsManualInput(false);
    setManualCode(DEFAULT_PREFIX);
    setReason(REASON_OPTIONS[0]);
    setDescription('');
    setVideoBlob(null);
    setUploadSuccess(false);
    setIsScanning(true);
  };

  const getBlobSizeInMB = (blob: Blob) => {
    return (blob.size / (1024 * 1024)).toFixed(2);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col max-w-md mx-auto shadow-2xl relative font-sans">
      
      {/* HEADER HIỆN ĐẠI */}
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-5 py-4 sticky top-0 z-50 flex justify-between items-center">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-xl shadow-lg shadow-orange-500/20 text-white">
            <PackageCheck size={20} />
          </div>
          <div>
            <h1 className="font-bold text-base tracking-tight text-slate-100">SPX Express</h1>
            <p className="text-[11px] text-slate-400 font-medium">Hệ thống ghi nhận đơn lỗi</p>
          </div>
        </div>
        <button 
          onClick={handleReset} 
          title="Làm mới"
          className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 rounded-xl transition active:scale-95"
        >
          <RefreshCw size={18} />
        </button>
      </header>

      {uploadSuccess ? (
        /* THÔNG BÁO THÀNH CÔNG SANG TRỌNG */
        <div className="p-6 flex-1 flex flex-col justify-center items-center text-center space-y-5 animate-in fade-in zoom-in-95 duration-300">
          <div className="relative">
            <div className="absolute -inset-1 rounded-full bg-emerald-500/20 blur-xl"></div>
            <div className="relative bg-slate-900 border border-emerald-500/30 p-5 rounded-full text-emerald-400 shadow-2xl">
              <CheckCircle2 size={56} />
            </div>
          </div>
          
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-100">Tải Lên Thành Công!</h2>
            <p className="text-xs text-slate-400">Đơn hàng đã được ghi nhận vào hệ thống</p>
          </div>

          <div className="w-full bg-slate-900/90 border border-slate-800 p-4 rounded-2xl space-y-2.5 text-left">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Mã vận đơn:</span>
              <span className="font-mono font-bold text-orange-400 bg-orange-500/10 px-2 py-0.5 rounded border border-orange-500/20">{trackingCode}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Loại lỗi:</span>
              <span className="text-slate-200 font-medium">{reason}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Trạng thái:</span>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <Sparkles size={12} /> Đã lưu Drive & Sheet
              </span>
            </div>
          </div>

          <button
            onClick={handleReset}
            className="w-full mt-4 py-3.5 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/20 active:scale-[0.98] transition"
          >
            Quét Đơn Tiếp Theo
          </button>
        </div>
      ) : (
        <main className="p-4 space-y-4 flex-1 pb-10">

          {/* BƯỚC 1: QUÉT / NHẬP MÃ */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center text-xs font-bold">1</span>
                <h2 className="font-semibold text-sm text-slate-200">Mã Vận Đơn</h2>
              </div>
              <button
                onClick={() => {
                  setIsManualInput(!isManualInput);
                  if (!isManualInput) stopScanner();
                  else setIsScanning(true);
                }}
                className="text-xs text-amber-400/90 hover:text-amber-300 font-medium flex items-center gap-1.5 transition"
              >
                <Edit3 size={13} /> {isManualInput ? "Dùng Camera Quét" : "Nhập tay"}
              </button>
            </div>

            {!isManualInput && !trackingCode && (
              <div className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                <div id="reader" className="w-full h-56"></div>
                
                {/* Visual Overlay */}
                <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between p-3">
                  <span className="text-[11px] bg-slate-900/90 text-slate-300 px-3 py-1 rounded-full border border-slate-700/60 shadow-lg">
                    Căn mã vạch vào khung bên dưới
                  </span>
                  
                  <div className="w-[80%] h-28 border border-orange-500/60 rounded-lg relative flex items-center justify-center bg-orange-500/5">
                    <div className="w-full h-[1.5px] bg-gradient-to-r from-transparent via-orange-400 to-transparent animate-pulse shadow-[0_0_8px_rgba(249,115,22,0.8)]"></div>
                  </div>

                  <span className="text-[10px] text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">Tự động nhận diện</span>
                </div>
              </div>
            )}

            {isManualInput && !trackingCode && (
              <div className="space-y-2 pt-1">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    placeholder="SPXVN12345678"
                    className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-slate-100 font-mono text-sm uppercase focus:border-orange-500/80 focus:ring-1 focus:ring-orange-500/50 outline-none transition"
                  />
                  <button
                    onClick={() => {
                      if (manualCode.trim()) {
                        setTrackingCode(manualCode.trim());
                      }
                    }}
                    className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 rounded-xl font-medium text-sm transition active:scale-95"
                  >
                    Lưu
                  </button>
                </div>
              </div>
            )}

            {trackingCode && (
              <div className="bg-slate-950/60 border border-emerald-500/30 p-3 rounded-xl flex justify-between items-center">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg">
                    <Check size={16} />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block font-medium">Mã đã ghi nhận</span>
                    <span className="text-base font-mono font-bold text-slate-100 tracking-wide">{trackingCode}</span>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setTrackingCode('');
                    setIsScanning(true);
                  }}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 px-3 py-1.5 rounded-lg transition"
                >
                  Quét lại
                </button>
              </div>
            )}
          </section>

          {/* BƯỚC 2: PHÂN LOẠI LỖI */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-xs font-bold">2</span>
              <h2 className="font-semibold text-sm text-slate-200">Chi Tiết Sự Cố</h2>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-slate-400 mb-1.5 block font-medium">Loại lỗi đơn hàng:</label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-orange-500/80 outline-none transition cursor-pointer"
                >
                  {REASON_OPTIONS.map((opt) => (
                    <option key={opt} value={opt} className="bg-slate-900 text-slate-200">{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 mb-1.5 block font-medium">Ghi chú bổ sung (tùy chọn):</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="VD: Móp góc trái, tem bị rách..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-orange-500/80 outline-none resize-none transition"
                ></textarea>
              </div>
            </div>
          </section>

          {/* BƯỚC 3: QUAY VIDEO MINH CHỨNG */}
          <section className="bg-slate-900/80 backdrop-blur border border-slate-800/80 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center justify-center text-xs font-bold">3</span>
                <h2 className="font-semibold text-sm text-slate-200">Video Minh Chứng</h2>
              </div>
              <span className="text-[11px] text-slate-400">Khuyên dùng &lt; 10s</span>
            </div>

            {!videoBlob ? (
              <div className="space-y-3">
                <video
                  ref={videoPreviewRef}
                  className={`w-full h-44 bg-slate-950 rounded-xl object-cover border border-slate-800 ${recording ? 'block' : 'hidden'}`}
                  playsInline
                  autoPlay
                ></video>

                {!recording ? (
                  <button
                    onClick={startRecording}
                    className="w-full py-3 bg-slate-800 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 rounded-xl font-medium flex items-center justify-center gap-2 text-xs shadow-md transition active:scale-[0.99]"
                  >
                    <Video size={16} className="text-orange-400" /> Bắt Đầu Quay Video
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    className="w-full py-3 bg-rose-500/10 border border-rose-500/30 text-rose-400 font-medium rounded-xl flex items-center justify-center gap-2 text-xs animate-pulse shadow-md transition"
                  >
                    <div className="w-2.5 h-2.5 bg-rose-500 rounded-full"></div> Dừng Quay & Lưu Video
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-slate-950/60 border border-emerald-500/30 p-3.5 rounded-xl space-y-2.5 text-center">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                    <Check size={16} className="p-0.5 bg-emerald-500/20 rounded-full" />
                    <span>Đã quay xong video</span>
                  </div>
                  <span className="font-mono text-xs text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    {getBlobSizeInMB(videoBlob)} MB
                  </span>
                </div>

                <button
                  onClick={() => setVideoBlob(null)}
                  className="text-xs text-slate-400 hover:text-rose-400 flex items-center justify-center gap-1.5 w-full pt-1 transition"
                >
                  <Trash2 size={13} /> Quay lại video khác
                </button>
              </div>
            )}
          </section>

          {/* NÚT UPLOAD HOÀN TẤT */}
          <button
            disabled={isUploading || !trackingCode || !videoBlob}
            onClick={handleSubmit}
            className={`w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 text-sm shadow-xl transition-all duration-200 ${
              isUploading || !trackingCode || !videoBlob
                ? 'bg-slate-800/50 border border-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-white shadow-orange-500/25 active:scale-[0.98]'
            }`}
          >
            {isUploading ? (
              <>
                <RefreshCw size={18} className="animate-spin text-white" /> Đang Tải Lên Dữ Liệu...
              </>
            ) : (
              <>
                <Upload size={18} /> Gửi Báo Cáo Đơn Lỗi
              </>
            )}
          </button>
        </main>
      )}
    </div>
  );
}