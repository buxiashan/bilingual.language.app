
import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractAudio = async (videoUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const videoElement = document.createElement('video');
      videoElement.src = videoUrl;
      videoElement.crossOrigin = "anonymous";
      
      const timeoutId = setTimeout(() => {
        reject(new Error("Audio extraction timed out. Please try a smaller video or check if the format is supported."));
      }, 60000); // 1 minute timeout for extraction

      videoElement.onloadedmetadata = async () => {
        try {
          // Attempt to get audio data
          const response = await fetch(videoUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          
          const base64 = await audioBufferToBase64(audioBuffer);
          clearTimeout(timeoutId);
          resolve(base64);
        } catch (e: any) {
          clearTimeout(timeoutId);
          reject(new Error(`Failed to extract audio: ${e.message}. Try converting the video to a different format.`));
        }
      };
      
      videoElement.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error("The video file could not be loaded. Please ensure it's a valid video format."));
      };
    });
  };

  const audioBufferToBase64 = async (buffer: AudioBuffer): Promise<string> => {
    return new Promise((resolve) => {
      const offlineCtx = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(offlineCtx.destination);
      source.start();
      offlineCtx.startRendering().then((renderedBuffer) => {
        const wavBlob = bufferToWav(renderedBuffer);
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(wavBlob);
      });
    });
  };

  const bufferToWav = (abuffer: AudioBuffer) => {
    let numOfChan = abuffer.numberOfChannels,
      length = abuffer.length * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [], 
      i = 0, 
      sample = 0, 
      offset = 0, 
      pos = 0;

    const setUint32 = (data: number) => {
      view.setUint32(pos, data, true);
      pos += 4;
    };
    const setUint16 = (data: number) => {
      view.setUint16(pos, data, true);
      pos += 2;
    };

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8);
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt "
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164); // "data"
    setUint32(length - pos - 4);

    for (i = 0; i < abuffer.numberOfChannels; i++)
      channels.push(abuffer.getChannelData(i));

    let internalPos = 44;
    while (offset < abuffer.length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
        view.setInt16(internalPos, sample, true);
        internalPos += 2;
      }
      offset++;
    }

    return new Blob([buffer], { type: "audio/wav" });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024 * 1024) {
        setProcessing({ 
          status: 'error', 
          progress: 0, 
          message: 'File too large: The 5GB limit was exceeded. Please upload a smaller file.' 
        });
        return;
      }
      const url = URL.createObjectURL(file);
      setVideo({
        name: file.name,
        url: url,
        size: file.size,
        type: file.type
      });
      setSubtitles([]);
      setProcessing({ status: 'idle', progress: 0, message: '' });
    }
  };

  const startAnalysis = async () => {
    if (!video) return;

    try {
      setProcessing({ status: 'extracting', progress: 10, message: 'Extracting audio from video...' });
      const audioBase64 = await extractAudio(video.url);
      
      setProcessing({ status: 'analyzing', progress: 40, message: 'Analyzing speech with Gemini...' });
      const result = await processVideoWithAI(audioBase64, (msg) => {
        setProcessing(prev => ({ ...prev, message: msg }));
      });
      
      setSubtitles(result);
      setProcessing({ status: 'completed', progress: 100, message: 'Subtitles generated successfully!' });
    } catch (err: any) {
      setProcessing({ 
        status: 'error', 
        progress: 0, 
        message: err.message || 'An unknown error occurred. Please try again or use a different video.' 
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
        <p className="text-slate-400">AI-Powered English-Chinese Transcription & Translation</p>
      </header>

      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Controls Section */}
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <CloudArrowUpIcon className="w-6 h-6 text-yellow-400" />
              Upload Video
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
                <p className="font-medium">Choose Video File</p>
                <p className="text-xs text-slate-500 mt-1">Up to 5GB (MP4, MKV, MOV)</p>
              </div>

              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <LinkIcon className="h-5 w-5 text-slate-500" />
                </div>
                <input
                  type="text"
                  placeholder="Paste YouTube URL..."
                  disabled // Placeholder for actual YouTube logic which requires server-side/complex proxy
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
                      {processing.status === 'error' ? 'Try Again' : 'Process Video'}
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

          {/* Error & Progress Feedback */}
          {processing.status !== 'idle' && (
            <section className={`bg-slate-900 rounded-2xl p-6 border shadow-lg transition-colors ${
              processing.status === 'error' ? 'border-red-900/50 bg-red-950/10' : 'border-slate-800'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold ${processing.status === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                  {processing.status === 'error' ? 'Error Occurred' : 'Current Task'}
                </h3>
                {processing.status === 'completed' && <CheckCircleIcon className="w-5 h-5 text-green-400" />}
                {processing.status === 'error' && <ExclamationCircleIcon className="w-6 h-6 text-red-500" />}
              </div>
              
              {processing.status !== 'error' && (
                <div className="w-full bg-slate-800 rounded-full h-1.5 mb-4">
                  <div 
                    className="h-1.5 rounded-full bg-yellow-400 transition-all duration-500"
                    style={{ width: `${processing.progress}%` }}
                  />
                </div>
              )}
              
              <div className={`text-sm ${processing.status === 'error' ? 'text-red-200' : 'text-slate-400'}`}>
                {processing.message}
                
                {processing.status === 'error' && (
                  <div className="mt-4 p-4 bg-red-500/10 rounded-lg border border-red-500/20">
                    <p className="font-semibold text-red-400 mb-2">Suggestions:</p>
                    <ul className="list-disc list-inside text-xs space-y-1 text-red-300/80">
                      <li>Check your internet connection</li>
                      <li>Try a shorter video clip (e.g. under 10 minutes)</li>
                      <li>Ensure the video has clear English speech</li>
                      <li>Wait a minute and click "Try Again"</li>
                    </ul>
                    <button 
                      onClick={startAnalysis}
                      className="mt-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-400 hover:text-red-300 transition-colors"
                    >
                      <ArrowPathIcon className="w-3 h-3" />
                      Restart Process
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Downloads Section */}
          {subtitles.length > 0 && (
            <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 shadow-xl animate-in fade-in">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <ArrowDownTrayIcon className="w-6 h-6 text-yellow-400" />
                Downloads
              </h2>
              <div className="space-y-2">
                <button onClick={() => downloadSRT('en')} className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm flex justify-between items-center transition-colors">
                  English SRT <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <button onClick={() => downloadSRT('zh')} className="w-full text-left p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm flex justify-between items-center transition-colors">
                  Chinese SRT <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
                <button onClick={() => downloadSRT('bilingual')} className="w-full text-left p-3 bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 rounded-xl text-sm flex justify-between items-center transition-colors font-bold">
                  Bilingual SRT <ArrowDownTrayIcon className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}
        </div>

        {/* Preview Section */}
        <div className="lg:col-span-2 space-y-6">
          <section className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl relative aspect-video">
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
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-all flex items-center justify-center group cursor-pointer" onClick={togglePlay}>
                  <button className="p-6 rounded-full bg-yellow-400 text-slate-950 opacity-0 group-hover:opacity-100 transform scale-90 group-hover:scale-100 transition-all shadow-xl">
                    {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8 pl-1" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <PlayIcon className="w-16 h-16 mb-4 opacity-10" />
                <p>Upload a video to see the preview and real-time subtitles</p>
              </div>
            )}
          </section>

          <section className="bg-slate-900 rounded-2xl p-6 border border-slate-800 h-[450px] flex flex-col shadow-xl">
            <h2 className="text-xl font-semibold mb-4">Transcription Preview</h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 scroll-smooth">
              {subtitles.length > 0 ? (
                subtitles.map((sub) => (
                  <div 
                    key={sub.index}
                    onClick={() => { if (videoRef.current) videoRef.current.currentTime = sub.startSeconds; }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      currentTime >= sub.startSeconds && currentTime <= sub.endSeconds
                        ? 'bg-yellow-400/10 border-yellow-400/50 scale-[1.01]'
                        : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1 text-[10px] text-slate-500 font-mono">
                      <span>{sub.startTime}</span>
                      <span>{sub.endTime}</span>
                    </div>
                    <p className="font-montserrat text-sm text-yellow-400 mb-1 leading-tight">{sub.originalText}</p>
                    <p className="font-source-han text-xs text-slate-300 leading-relaxed">{sub.translatedText}</p>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                  <CpuChipIcon className="w-12 h-12 opacity-5" />
                  <p className="text-sm">Subtitles will appear here once processing is complete.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto mt-16 pb-8 border-t border-slate-800 pt-8 text-center text-slate-500 text-xs">
        <p>&copy; 2024 Bilingual Subtitle Pro • Precision Transcription & Translation</p>
      </footer>
    </div>
  );
};

export default App;
