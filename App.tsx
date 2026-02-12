
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
  ArrowPathIcon
} from '@heroicons/react/24/outline';

const App: React.FC = () => {
  const [video, setVideo] = useState<VideoMetadata | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [processing, setProcessing] = useState<ProcessingState>({ 
    status: 'idle', 
    progress: 0, 
    message: '' 
  });
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Memory-efficient audio extraction.
   * Instead of decodeAudioData(entireVideoBuffer), we play the video silently
   * through an AudioContext and capture the stream.
   */
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
      
      // Mono conversion
      const merger = audioCtx.createChannelMerger(1);
      source.connect(merger);
      merger.connect(streamDest);

      const mediaRecorder = new MediaRecorder(streamDest.stream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(chunks, { type: 'audio/webm' });
          // Convert the WebM/Ogg blob to a Base64 string for Gemini
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
        // Since we are in a browser, we have to "play" to extract.
        // For very large files, this is the only way without a server or WASM FFmpeg.
        // We set playbackRate high if supported to speed up extraction.
        try {
          hiddenVideo.playbackRate = 16; // Speed up extraction 16x
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
        reject(new Error("Video playback error during extraction. The file might be corrupted or in an unsupported format."));
      };

      // Safety timeout
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
          hiddenVideo.pause();
          reject(new Error("Extraction timed out. Try a smaller file or a different browser."));
        }
      }, 300000); // 5 minute max extraction time
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Browsers handle Blob URLs very efficiently. It doesn't load into RAM.
      const url = URL.createObjectURL(file);
      setVideo({
        name: file.name,
        url: url,
        size: file.size,
        type: file.type
      });
      setSubtitles([]);
      setProcessing({ status: 'idle', progress: 0, message: '' });
      
      if (file.size > 2 * 1024 * 1024 * 1024) {
        setProcessing({ 
          status: 'idle', 
          progress: 0, 
          message: 'Warning: This is a large file (>2GB). Extraction may take longer.' 
        });
      }
    }
  };

  const startAnalysis = async () => {
    if (!video) return;

    try {
      setProcessing({ status: 'extracting', progress: 5, message: 'Preparing audio extraction...' });
      
      // Using the more memory-efficient streaming extraction method
      const audioBase64 = await extractAudioEfficiently(video.url);
      
      setProcessing({ status: 'analyzing', progress: 40, message: 'AI Analysis & Translation starting...' });
      
      const result = await processVideoWithAI(audioBase64, (msg) => {
        setProcessing(prev => {
          const currentProg = prev.progress;
          return { ...prev, message: msg, progress: Math.min(currentProg + 5, 95) };
        });
      });
      
      setSubtitles(result);
      setProcessing({ status: 'completed', progress: 100, message: 'Bilingual subtitles ready!' });
    } catch (err: any) {
      setProcessing({ 
        status: 'error', 
        progress: 0, 
        message: err.message || 'Processing failed. Try a smaller video or check your internet.' 
      });
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

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans">
      <header className="max-w-6xl mx-auto mb-10 text-center">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-white bg-clip-text text-transparent mb-2">
          Bilingual Subtitle Pro
        </h1>
        <p className="text-slate-400">Professional English-Chinese AI Subtitle Synthesis</p>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <CloudArrowUpIcon className="w-6 h-6 text-yellow-400" />
              Source Video
            </h2>
            
            <div className="space-y-4">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-yellow-400/50 hover:bg-slate-800 transition-all group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="video/*" 
                  className="hidden" 
                />
                <CloudArrowUpIcon className="w-10 h-10 mx-auto mb-3 text-slate-500 group-hover:text-yellow-400 transition-colors" />
                <p className="font-medium">Upload Local Video</p>
                <p className="text-xs text-slate-500 mt-1">Memory Optimized for Large Files (up to 5GB)</p>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LinkIcon className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  placeholder="Paste YouTube URL..."
                  disabled 
                  className="block w-full pl-10 pr-3 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-sm cursor-not-allowed opacity-50"
                />
              </div>
            </div>

            {video && (
              <div className="mt-6 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
                <p className="text-sm font-medium truncate mb-1">{video.name}</p>
                <p className="text-xs text-slate-500">{(video.size / (1024 * 1024)).toFixed(2)} MB</p>
                
                <button
                  onClick={startAnalysis}
                  disabled={processing.status !== 'idle' && processing.status !== 'completed' && processing.status !== 'error'}
                  className="w-full mt-4 bg-yellow-400 hover:bg-yellow-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-yellow-400/10"
                >
                  {processing.status === 'idle' || processing.status === 'completed' || processing.status === 'error' ? (
                    <>
                      <CpuChipIcon className="w-5 h-5" />
                      {processing.status === 'error' ? 'Retry Process' : 'Start AI Generation'}
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </div>
                  )}
                </button>
              </div>
            )}
          </section>

          {processing.status !== 'idle' && (
            <section className={`bg-slate-900 rounded-2xl p-6 border shadow-lg transition-colors ${
              processing.status === 'error' ? 'border-red-900/50 bg-red-950/10' : 'border-slate-800'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${processing.status === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                  {processing.status === 'error' ? 'Processing Error' : 'System Status'}
                </h3>
                {processing.status === 'completed' && <CheckCircleIcon className="w-5 h-5 text-green-400" />}
                {processing.status === 'error' && <ExclamationCircleIcon className="w-6 h-6 text-red-500" />}
              </div>
              
              {processing.status !== 'error' && (
                <div className="w-full bg-slate-800 h-2 rounded-full mb-4 overflow-hidden">
                  <div 
                    className="h-full bg-yellow-400 transition-all duration-300 ease-out"
                    style={{ width: `${processing.progress}%` }}
                  />
                </div>
              )}
              
              <div className={`text-sm ${processing.status === 'error' ? 'text-red-200' : 'text-slate-400'}`}>
                {processing.message}
                
                {processing.status === 'error' && (
                  <div className="mt-4 p-4 bg-red-500/10 rounded-lg border border-red-500/20 text-xs">
                    <p className="font-semibold text-red-400 mb-2">How to fix this:</p>
                    <ul className="list-disc list-inside space-y-1 text-red-300/80">
                      <li>Ensure your video has audible English speech.</li>
                      <li>Try refreshing the page if the browser feels slow.</li>
                      <li>For 5GB+ files, try a smaller segment if this fails.</li>
                    </ul>
                    <button 
                      onClick={startAnalysis}
                      className="mt-4 flex items-center gap-2 font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
                    >
                      <ArrowPathIcon className="w-3 h-3" />
                      Retry Analysis
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {subtitles.length > 0 && (
            <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl animate-in fade-in">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <ArrowDownTrayIcon className="w-6 h-6 text-yellow-400" />
                Export
              </h2>
              <div className="space-y-2">
                <button onClick={() => downloadSRT('en')} className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm flex justify-between items-center">
                  English Only <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <button onClick={() => downloadSRT('zh')} className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm flex justify-between items-center">
                  Chinese Only <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <button onClick={() => downloadSRT('bilingual')} className="w-full text-left p-3 bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 rounded-xl text-sm flex justify-between items-center font-bold">
                  Bilingual (Recommended) <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <section className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative aspect-video group">
            {video ? (
              <div className="relative w-full h-full bg-black">
                <video
                  ref={videoRef}
                  src={video.url}
                  className="w-full h-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
                <SubtitleOverlay subtitles={subtitles} currentTime={currentTime} />
                <div 
                  className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center cursor-pointer" 
                  onClick={togglePlay}
                >
                  <button className="p-6 rounded-full bg-yellow-400 text-slate-950 opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 transition-all shadow-xl">
                    {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8 pl-1" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <PlayIcon className="w-16 h-16 mb-4 opacity-10" />
                <p className="text-slate-400 font-medium">Preview Area</p>
                <p className="text-xs text-slate-600">Video preview and real-time subtitles will appear here</p>
              </div>
            )}
          </section>

          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 h-[450px] flex flex-col shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex justify-between items-center">
              <span>Timeline Preview</span>
              <span className="text-xs font-mono text-slate-500">{subtitles.length} lines</span>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scroll-smooth scrollbar-thin">
              {subtitles.length > 0 ? (
                subtitles.map((sub) => (
                  <div 
                    key={sub.index}
                    onClick={() => { if (videoRef.current) videoRef.current.currentTime = sub.startSeconds; }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      currentTime >= sub.startSeconds && currentTime <= sub.endSeconds
                        ? 'bg-yellow-400/10 border-yellow-400/50 scale-[1.01] shadow-lg'
                        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 text-[10px] text-slate-500 font-mono">
                      <span>{sub.startTime}</span>
                      <span className="w-2 h-0.5 bg-slate-700"></span>
                      <span>{sub.endTime}</span>
                    </div>
                    <p className="font-montserrat text-sm text-yellow-400 mb-1 leading-tight">{sub.originalText}</p>
                    <p className="font-source-han text-xs text-slate-300 leading-relaxed">{sub.translatedText}</p>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2 opacity-30">
                  <CpuChipIcon className="w-12 h-12" />
                  <p className="text-sm italic">Transcripts will populate here...</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto mt-16 pb-8 border-t border-slate-800 pt-8 text-center text-slate-600 text-[10px]">
        <p>BILINGUAL SUBTITLE PRO &bull; ADVANCED MEMORY-SAFE EXTRACTION ENGINE</p>
      </footer>
    </div>
  );
};

export default App;
