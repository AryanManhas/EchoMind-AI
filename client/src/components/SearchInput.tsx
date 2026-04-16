import { Search, X } from 'lucide-react';
import { useRef, useEffect } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (val: string) => void;
  isLoading?: boolean;
}

export default function SearchInput({ value, onChange, isLoading }: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative group w-full">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <Search className={`w-4 h-4 transition-colors ${value ? 'text-[#c799ff]' : 'text-white/30 group-focus-within:text-[#c799ff]'}`} />
      </div>
      
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search transcript or summary... (⌘K)"
        className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-11 pr-10 text-[13px] text-white placeholder-white/30 outline-none transition-all focus:bg-white/10 focus:border-[#c799ff]/50 focus:shadow-[0_0_20px_rgba(199,153,255,0.15)] backdrop-blur-md"
      />

      {(value || isLoading) && (
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-[#c799ff]/30 border-t-[#c799ff] rounded-full animate-spin" />
          ) : (
            <button
              onClick={() => onChange('')}
              className="p-1 rounded-full text-white/30 hover:text-white hover:bg-white/10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
