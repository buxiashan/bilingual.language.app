
import React, { useState, useRef, useEffect } from 'react';
import { VideoMetadata, Subtitle, ProcessingState } from './types';
import { processVideoWithAI } from './services/gemini';
import { generateSRT, downloadFile } from './utils/srt';
import SubtitleOverlay from './components/SubtitleOverlay';
import { 
  CloudArrowUpIcon, 
  LinkIcon, 
  ArrowDownTrayIcon, 
  CpuChipIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
  PlayIcon,
  PauseIcon,
  ArrowPathIcon,
  VideoCameraIcon
} from '@heroicons/react/24/outline';

const App: React.FC = () => {
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({ 
    status: 'idle', 
    progress: 0, 
    message: '' 
  });
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesisProgress, setSynthesisProgress] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
  };

  const extractAudioEfficiently = async (videoUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const hiddenVideo = document.createElement('video');
      hiddenVideo.src = videoUrl;
      hiddenVideo.muted = true;
      hiddenVideo.hidden = true;
      hiddenVideo.crossOrigin = "anonymous";
      
      const streamDest = audioCtx.createMediaStreamDestination();
      const source = audioCtx.createMediaElementSource(hiddenVideo);
      
      const merger = audioCtx.createChannelMerger(1);
      source.connect(merger);
      merger.connect(streamDest);

      const mediaRecorder = new MediaRecorder(streamDest.stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
          };
          reader.readAsDataURL(audioBlob);
          audioCtx.close();
        } catch (e) {
          reject(e);
        }
      };

      hiddenVideo.onloadedmetadata = () => {
        try {
          hiddenVideo.playbackRate = 16;
        } catch (e) {
          hiddenVideo.playbackRate = 1;
        }
        mediaRecorder.start();
        hiddenVideo.play();
        
        const updateProgress = () => {
          const prog = Math.round((hiddenVideo.currentTime / hiddenVideo.duration) * 30);
          setProcessing(prev => ({ ...prev, progress: 10 + prog, message: `Extracting Audio (${Math.round(prog * 3.3)}%)...` }));
          if (!hiddenVideo.paused && !hiddenVideo.ended) {
            requestAnimationFrame(updateProgress);
          }
        };
        updateProgress();
      };

      hiddenVideo.onended = () => {
        mediaRecorder.stop();
      };

      hiddenVideo.onerror = () => {
        reject(new Error("Video playback error during extraction."));
      };

      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          hiddenVideo.pause();
          reject(new Error("Extraction timed out."));
        }
      }, 600000); // 10 minute max extraction time
    });
  };

  const synthesizeVideo = async () => {
    if (!video || subtitles.length === 0 || !videoRef.current) return;

    setIsSynthesizing(true);
    setSynthesisProgress(0);

    const videoEl = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stream = canvas.captureStream(30);
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(videoEl);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(dest);
    source.connect(audioCtx.destination); 
    
    const combinedStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const recorder = new MediaRecorder(combinedStream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      downloadFile(URL.createObjectURL(blob), `${video.name.split('.')[0]}_bilingual.webm`, 'video/webm');
      setIsSynthesizing(false);
      videoEl.pause();
    };

    recorder.start();
    videoEl.currentTime = 0;
    videoEl.muted = false;
    await videoEl.play();

    const renderFrame = () => {
      if (videoEl.ended || !isSynthesizing) {
        recorder.stop();
        return;
      }

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const cur = videoEl.currentTime;
      const sub = subtitles.find(s => cur >= s.startSeconds && cur <= s.endSeconds);

      if (sub) {
        const padding = 20;
        const fontSizeEn = canvas.height * 0.04;
        const fontSizeZh = canvas.height * 0.035;
        const bottomOffset = canvas.height * 0.08;

        ctx.font = `bold ${fontSizeEn}px Montserrat, sans-serif`;
        const textEnWidth = ctx.measureText(sub.originalText).width;
        
        ctx.font = `${fontSizeZh}px "Noto Sans SC", sans-serif`;
        const textZhWidth = ctx.measureText(sub.translatedText).width;

        const boxWidth = Math.max(textEnWidth, textZhWidth) + padding * 2;
        const boxHeight = fontSizeEn + fontSizeZh + padding * 2;
        const boxX = (canvas.width - boxWidth) / 2;
        const boxY = canvas.height - boxHeight - bottomOffset;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 8);
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#facc15'; 
        ctx.font = `bold ${fontSizeEn}px Montserrat, sans-serif`;
        ctx.fillText(sub.originalText, canvas.width / 2, boxY + padding + fontSizeEn * 0.8);

        ctx.fillStyle = '#ffffff';
        ctx.font = `${fontSizeZh}px "Noto Sans SC", sans-serif`;
        ctx.fillText(sub.translatedText, canvas.width / 2, boxY + padding + fontSizeEn + fontSizeZh);
      }

      setSynthesisProgress(Math.round((videoEl.currentTime / videoEl.duration) * 100));
      requestAnimationFrame(renderFrame);
    };

    renderFrame();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideo({
        name: file.name,
        url: url,
        size: file.size,
        type: file.type
      });
      setSubtitles([]);
      setProcessing({ status: 'idle', progress: 0, message: '' });
      setCurrentTime(0);
      setDuration(0);
    }
  };

  const startAnalysis = async () => {
    if (!video) return;
    try {
      setProcessing({ status: 'extracting', progress: 5, message: 'Preparing audio extraction...' });
      const audioBase64 = await extractAudioEfficiently(video.url);
      setProcessing({ status: 'analyzing', progress: 40, message: 'AI Analysis & Translation starting...' });
      const result = await processVideoWithAI(audioBase64, (msg) => {
        setProcessing(prev => ({ ...prev, message: msg, progress: Math.min(prev.progress + 2, 98) }));
      });
      setSubtitles(result);
      setProcessing({ status: 'completed', progress: 100, message: 'Bilingual subtitles ready!' });
    } catch (err: any) {
      setProcessing({ status: 'error', progress: 0, message: err.message || 'Processing failed.' });
    }
  };

  const downloadSRT = (lang: 'en' | 'zh' | 'bilingual') => {
    const filename = `${video?.name.split('.')[0] || 'subtitles'}_${lang}.srt`;
    const content = generateSRT(subtitles, lang);
    downloadFile(content, filename, 'text/plain');
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      {/* Synthesis Progress Modal */}
      {isSynthesizing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
            <VideoCameraIcon className="w-16 h-16 text-yellow-400 mx-auto mb-4 animate-pulse" />
            <h2 className="text-2xl font-bold mb-2">Synthesizing Video</h2>
            <p className="text-slate-400 text-sm mb-6">Burning subtitles into video stream... Please do not close the tab.</p>
            <div className="w-full bg-slate-800 h-4 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-yellow-400 transition-all duration-300" style={{ width: `${synthesisProgress}%` }} />
            </div>
            <p className="text-yellow-400 font-mono text-sm">{synthesisProgress}%</p>
            <button 
              onClick={() => setIsSynthesizing(false)}
              className="mt-8 text-slate-500 hover:text-white transition-colors text-xs uppercase tracking-widest font-bold"
            >
              Cancel Synthesis
            </button>
          </div>
        </div>
      )}

      <header className="max-w-6xl mx-auto mb-10 text-center">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-white bg-clip-text text-transparent mb-2">
          Bilingual Subtitle Pro
        </h1>
        <p className="text-slate-400">Exhaustive English-Chinese AI Synthesis Engine</p>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <CloudArrowUpIcon className="w-6 h-6 text-yellow-400" />
              Upload Source
            </h2>
            <div className="space-y-4">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-yellow-400/50 hover:bg-slate-800 transition-all group"
              >
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="video/*" className="hidden" />
                <CloudArrowUpIcon className="w-10 h-10 mx-auto mb-3 text-slate-500 group-hover:text-yellow-400 transition-colors" />
                <p className="font-medium">Upload Local Video</p>
                <p className="text-xs text-slate-500 mt-1">Supports up to 5GB (Optimized)</p>
              </div>
            </div>

            {video && (
              <div className="mt-6 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                <p className="text-sm font-medium truncate mb-1">{video.name}</p>
                <p className="text-xs text-slate-500">{(video.size / (1024 * 1024)).toFixed(2)} MB</p>
                <button
                  onClick={startAnalysis}
                  disabled={processing.status !== 'idle' && processing.status !== 'completed' && processing.status !== 'error'}
                  className="w-full mt-4 bg-yellow-400 hover:bg-yellow-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg"
                >
                  {processing.status === 'idle' || processing.status === 'completed' || processing.status === 'error' ? (
                    <><CpuChipIcon className="w-5 h-5" /> {processing.status === 'error' ? 'Retry Process' : 'Generate Subtitles'}</>
                  ) : (
                    <div className="flex items-center gap-3"><div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>Processing...</div>
                  )}
                </button>
              </div>
            )}
          </section>

          {processing.status !== 'idle' && (
            <section className={`bg-slate-900 rounded-2xl p-6 border shadow-lg ${processing.status === 'error' ? 'border-red-900/50 bg-red-950/10' : 'border-slate-800'}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${processing.status === 'error' ? 'text-red-400' : 'text-slate-300'}`}>System Log</h3>
                {processing.status === 'completed' && <CheckCircleIcon className="w-5 h-5 text-green-400" />}
                {processing.status === 'error' && <ExclamationCircleIcon className="w-6 h-6 text-red-500" />}
              </div>
              {processing.status !== 'error' && (
                <div className="w-full bg-slate-800 h-2 rounded-full mb-4 overflow-hidden">
                  <div className="h-full bg-yellow-400 transition-all duration-300" style={{ width: `${processing.progress}%` }} />
                </div>
              )}
              <div className="text-sm text-slate-400">{processing.message}</div>
            </section>
          )}

          {subtitles.length > 0 && (
            <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl animate-in fade-in">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <ArrowDownTrayIcon className="w-6 h-6 text-yellow-400" />
                Export Assets
              </h2>
              <div className="space-y-3">
                <button 
                  onClick={synthesizeVideo} 
                  className="w-full p-4 bg-yellow-400 hover:bg-yellow-500 text-slate-950 rounded-xl text-sm flex justify-between items-center font-bold shadow-lg transition-transform hover:scale-[1.02]"
                >
                  <div className="flex items-center gap-2">
                    <VideoCameraIcon className="w-5 h-5" />
                    <span>Burn-in Bilingual Video</span>
                  </div>
                  <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800">
                  <button onClick={() => downloadSRT('en')} className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs text-center border border-slate-700">English SRT</button>
                  <button onClick={() => downloadSRT('zh')} className="p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs text-center border border-slate-700">Chinese SRT</button>
                </div>
                <button onClick={() => downloadSRT('bilingual')} className="w-full p-3 bg-slate-800/50 hover:bg-slate-800 rounded-xl text-xs font-semibold text-slate-400 border border-slate-700">Download Bilingual SRT</button>
              </div>
            </section>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <section className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative aspect-video group">
            {video ? (
              <div className="relative w-full h-full bg-black flex flex-col">
                <div className="relative flex-1 overflow-hidden" onClick={togglePlay}>
                  <video
                    ref={videoRef}
                    src={video.url}
                    className="w-full h-full object-contain"
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                  <SubtitleOverlay subtitles={subtitles} currentTime={currentTime} />
                  
                  {/* Play/Pause Overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center cursor-pointer">
                    <button className="p-6 rounded-full bg-yellow-400 text-slate-950 opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 transition-all shadow-xl">
                      {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8 pl-1" />}
                    </button>
                  </div>
                </div>

                {/* Interactive Controls Bar */}
                <div className="bg-slate-900 border-t border-slate-800 p-3 flex items-center gap-4">
                  <button onClick={togglePlay} className="text-yellow-400 hover:text-yellow-300">
                    {isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" />}
                  </button>
                  
                  <div className="flex-1 flex flex-col gap-1">
                    <input 
                      type="range"
                      min="0"
                      max={duration || 0}
                      step="0.01"
                      value={currentTime}
                      onChange={handleSeek}
                      className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-400"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-slate-500">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-500 opacity-20"><PlayIcon className="w-16 h-16 mb-4" /><p>Preview Surface</p></div>
            )}
          </section>

          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 h-[450px] flex flex-col shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex justify-between items-center">
              <span>Transcription Preview</span>
              <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">{subtitles.length} Lines</span>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-slate-700">
              {subtitles.length > 0 ? (
                subtitles.map((sub) => (
                  <div 
                    key={sub.index}
                    onClick={() => { if (videoRef.current) videoRef.current.currentTime = sub.startSeconds; }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      currentTime >= sub.startSeconds && currentTime <= sub.endSeconds ? 'bg-yellow-400/10 border-yellow-400/50 scale-[1.01] shadow-lg' : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 text-[10px] text-slate-500 font-mono"><span>{sub.startTime}</span><span className="w-2 h-0.5 bg-slate-700"></span><span>{sub.endTime}</span></div>
                    <p className="font-montserrat text-sm text-yellow-400 mb-1 leading-tight">{sub.originalText}</p>
                    <p className="font-source-han text-xs text-slate-300 leading-relaxed">{sub.translatedText}</p>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-700 space-y-2 opacity-50"><CpuChipIcon className="w-12 h-12" /><p className="text-xs italic">Awaiting process...</p></div>
              )}
            </div>
          </section>
        </div>
      </main>
      <footer className="max-w-6xl mx-auto mt-16 pb-8 border-t border-slate-800 pt-8 text-center text-slate-600 text-[10px] tracking-widest uppercase">
        Bilingual Subtitle Pro &bull; Exhaustive Synthesis Mode Active
      </footer>
    </div>
  );
};

export default App;
