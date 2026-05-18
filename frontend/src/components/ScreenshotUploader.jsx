// frontend/src/components/ScreenshotUploader.jsx
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ScreenshotUploader({ onScreenshot, screenshot, onRemove }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const processFile = useCallback((file) => {
    setError('');
    if (!file) return;

    // Validate type
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed (PNG, JPG, WEBP, GIF).');
      return;
    }
    // Validate size — 10 MB max
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // Extract base64 portion
      const base64 = dataUrl.split(',')[1];
      const mediaType = file.type;
      onScreenshot({ base64, mediaType, name: file.name, dataUrl });
    };
    reader.readAsDataURL(file);
  }, [onScreenshot]);

  const handleFileInput = (e) => {
    processFile(e.target.files?.[0]);
    // Reset so the same file can be re-uploaded
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    processFile(e.dataTransfer.files?.[0]);
  };

  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find(i => i.type.startsWith('image/'));
    if (imageItem) {
      processFile(imageItem.getAsFile());
    }
  }, [processFile]);

  // Expose paste handler via window so ChatArea can forward paste events
  // (attached in ChatArea via onPaste)

  if (screenshot) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative group"
      >
        <div className="relative rounded-xl overflow-hidden border border-cyan-500/30 bg-[#0d1117]">
          <img
            src={screenshot.dataUrl}
            alt="Uploaded screenshot"
            className="w-full max-h-40 object-cover"
          />
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
              onClick={onRemove}
              className="bg-red-500/90 hover:bg-red-500 text-white text-xs font-mono px-3 py-1.5 rounded-lg transition-colors"
            >
              ✕ Remove
            </button>
          </div>
          {/* Badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1">
            <span className="text-cyan-400 text-xs">📷</span>
            <span className="text-white text-xs font-mono truncate max-w-[140px]">{screenshot.name}</span>
          </div>
        </div>
        <p className="text-[#4a5568] text-xs font-mono mt-1.5 px-1">
          ✓ Screenshot attached — agents will analyze this design
        </p>
      </motion.div>
    );
  }

  return (
    <div>
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onPaste={handlePaste}
        onClick={() => inputRef.current?.click()}
        animate={{ borderColor: dragging ? 'rgba(6,182,212,0.6)' : 'rgba(28,35,51,1)' }}
        className="relative cursor-pointer rounded-xl border border-dashed transition-all duration-200 px-4 py-3 flex items-center gap-3 bg-[#0d1117] hover:border-cyan-500/40 hover:bg-cyan-500/5"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Icon */}
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
          dragging ? 'bg-cyan-500/20 border border-cyan-500/40' : 'bg-[#1c2333]'
        }`}>
          <span className="text-base">{dragging ? '⬇️' : '📷'}</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[#8892a4] text-xs font-medium">
            {dragging ? 'Drop screenshot here' : 'Attach a screenshot or design'}
          </p>
          <p className="text-[#4a5568] text-xs font-mono mt-0.5">
            Click, drag & drop, or paste (Ctrl+V) · PNG, JPG, WEBP · max 10 MB
          </p>
        </div>

        <span className="text-[#4a5568] text-xs font-mono shrink-0">optional</span>
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-red-400 text-xs font-mono mt-1.5 px-1"
          >
            ⚠ {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
