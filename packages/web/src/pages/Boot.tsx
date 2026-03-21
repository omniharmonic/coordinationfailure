import React, { useState, useEffect, useRef } from 'react';
import { useSound } from '../hooks/useSound.js';
import { SoundToggle } from '../components/SoundToggle.js';

const BOOT_LINES = [
  '========================================',
  '',
  '  COORDINATION FAILURE',
  '',
  '  "A strange game.',
  '   The only winning move',
  '   is not to play."',
  '',
  '         — WOPR, WarGames (1983)',
  '',
  '========================================',
  '',
  'PRESS ANY KEY TO CONTINUE...',
];

export function Boot({ onComplete }: { onComplete: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [charIdx, setCharIdx] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const charCountRef = useRef(0);
  const modemPlayedRef = useRef(false);
  const beepPlayedRef = useRef(false);

  const { playKeyClick, playModem, playBeep } = useSound();

  useEffect(() => {
    if (lineIdx >= BOOT_LINES.length) {
      setDone(true);
      return;
    }

    const currentLine = BOOT_LINES[lineIdx];

    if (charIdx >= currentLine.length) {
      // Line just completed — check for special lines
      if (currentLine.startsWith('========') && !modemPlayedRef.current) {
        modemPlayedRef.current = true;
        playModem();
      }
      if (currentLine === 'PRESS ANY KEY TO CONTINUE...' && !beepPlayedRef.current) {
        beepPlayedRef.current = true;
        playBeep();
      }

      // Move to next line
      const timeout = setTimeout(() => {
        setLines(prev => [...prev, currentLine]);
        setLineIdx(lineIdx + 1);
        setCharIdx(0);
      }, currentLine === '' ? 100 : 50);
      return () => clearTimeout(timeout);
    }

    const timeout = setTimeout(() => {
      // Play key click every 3rd character
      charCountRef.current += 1;
      if (charCountRef.current % 3 === 0) {
        playKeyClick();
      }
      setCharIdx(charIdx + 1);
    }, currentLine.startsWith('==') ? 5 : 25);

    return () => clearTimeout(timeout);
  }, [lineIdx, charIdx, playKeyClick, playModem, playBeep]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, charIdx]);

  useEffect(() => {
    if (!done) return;
    const handler = () => onComplete();
    window.addEventListener('keydown', handler);
    window.addEventListener('click', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('click', handler);
    };
  }, [done, onComplete]);

  const currentLine = lineIdx < BOOT_LINES.length ? BOOT_LINES[lineIdx].slice(0, charIdx) : '';

  return (
    <div ref={containerRef} style={{
      width: '100%',
      height: '100%',
      padding: '40px',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
    }}>
      <div style={{ position: 'fixed', top: '8px', right: '12px', zIndex: 10 }}>
        <SoundToggle />
      </div>
      {lines.map((line, i) => (
        <div key={i} style={{
          minHeight: '1.4em',
          textShadow: line.includes('COORDINATION FAILURE') ? '0 0 20px var(--crt-glow)' : '0 0 5px var(--crt-glow)',
          fontSize: line.includes('COORDINATION FAILURE') ? '2rem' : '1rem',
          letterSpacing: line.includes('COORDINATION FAILURE') ? '6px' : '1px',
        }}>
          {line}
        </div>
      ))}
      <div style={{ minHeight: '1.4em' }}>
        {currentLine}
        <span className="blink" style={{ borderRight: '2px solid var(--crt-text)' }}>&nbsp;</span>
      </div>
    </div>
  );
}
