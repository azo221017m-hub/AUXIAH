import { useState, useRef, useCallback } from 'react';

/**
 * Custom hook for Web Speech Recognition API.
 */
export default function useVoiceRecognition() {
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const recognitionRef = useRef(null);
  const timerRef = useRef(null);

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  const isSupported = !!SpeechRecognition;

  const start = useCallback((onTranscript, onEnd) => {
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-MX';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      onTranscript(transcript);
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted') {
        stop();
      }
    };

    recognition.onend = () => {
      if (timerRef.current) {
        stop();
        if (onEnd) onEnd();
      }
    };

    recognition.start();
    setIsRecording(true);

    let remaining = 10;
    setCountdown(remaining);
    timerRef.current = setInterval(() => {
      remaining--;
      setCountdown(remaining);
      if (remaining <= 0) {
        stop();
        if (onEnd) onEnd();
      }
    }, 1000);
  }, [SpeechRecognition]);

  const stop = useCallback(() => {
    setIsRecording(false);
    setCountdown(0);
    clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  return { isRecording, countdown, isSupported, start, stop };
}
