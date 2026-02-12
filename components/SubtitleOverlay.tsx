
import React from 'react';
import { Subtitle } from '../types';

interface Props {
  subtitles: Subtitle[];
  currentTime: number;
}

const SubtitleOverlay: React.FC<Props> = ({ subtitles, currentTime }) => {
  const activeSub = subtitles.find(
    (s) => currentTime >= s.startSeconds && currentTime <= s.endSeconds
  );

  if (!activeSub) return null;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end pb-12 transition-opacity duration-200">
      <div 
        className="max-w-[85%] px-6 py-4 rounded-lg shadow-2xl flex flex-col items-center gap-2"
        style={{ backgroundColor: 'rgba(0, 43, 53, 0.85)' }}
      >
        <p className="font-montserrat text-yellow-400 text-xl md:text-2xl font-bold text-center drop-shadow-md">
          {activeSub.originalText}
        </p>
        <p className="font-source-han text-white text-base md:text-lg font-medium text-center drop-shadow-sm">
          {activeSub.translatedText}
        </p>
      </div>
    </div>
  );
};

export default SubtitleOverlay;
