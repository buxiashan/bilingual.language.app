
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
    <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-end pb-6 transition-opacity duration-200">
      <div 
        className="max-w-[90%] px-4 py-2 rounded-md shadow-lg flex flex-col items-center gap-1"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      >
        <p className="font-montserrat text-yellow-400 text-lg md:text-xl font-bold text-center drop-shadow-md leading-tight">
          {activeSub.originalText}
        </p>
        <p className="font-source-han text-white text-sm md:text-base font-medium text-center drop-shadow-sm leading-tight">
          {activeSub.translatedText}
        </p>
      </div>
    </div>
  );
};

export default SubtitleOverlay;
