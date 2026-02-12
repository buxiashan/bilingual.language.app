
import { Subtitle } from '../types';

export const generateSRT = (subtitles: Subtitle[], mode: 'en' | 'zh' | 'bilingual'): string => {
  return subtitles.map((sub, i) => {
    let text = '';
    if (mode === 'en') text = sub.originalText;
    else if (mode === 'zh') text = sub.translatedText;
    else text = `${sub.originalText}\n${sub.translatedText}`;

    return `${i + 1}\n${sub.startTime} --> ${sub.endTime}\n${text}\n`;
  }).join('\n');
};

export const parseTimeToSeconds = (timeStr: string): number => {
  const [hms, ms] = timeStr.split(',');
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s + Number(ms) / 1000;
};

export const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
