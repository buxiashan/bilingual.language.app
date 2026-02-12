
export interface Subtitle {
  index: number;
  startTime: string; // HH:MM:SS,mmm
  endTime: string;
  originalText: string;
  translatedText: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ProcessingState {
  status: 'idle' | 'extracting' | 'analyzing' | 'completed' | 'error';
  progress: number;
  message: string;
}

export interface VideoMetadata {
  name: string;
  url: string;
  size: number;
  type: string;
}
