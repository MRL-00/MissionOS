import { useEffect, useRef } from "react";
import Picker from "emoji-picker-react";
import type { EmojiClickData } from "emoji-picker-react";
import { Theme } from "emoji-picker-react";
import { XIcon } from "lucide-react";

interface EmojiPickerProps {
  /** Currently selected emoji (if any) */
  value?: string;
  /** Called when the user picks an emoji */
  onSelect: (emoji: string) => void;
  /** Called when the user clears the current emoji */
  onClear?: () => void;
  /** Called when the picker should close */
  onClose: () => void;
}

/**
 * Full-featured emoji picker rendered as a centered modal overlay.
 * Uses `emoji-picker-react` under the hood so every Unicode emoji is available.
 */
export function EmojiPicker({ value, onSelect, onClear, onClose }: EmojiPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  /* Close when pressing Escape */
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleEmojiClick(emojiData: EmojiClickData) {
    onSelect(emojiData.emoji);
    onClose();
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div
        ref={panelRef}
        className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1c1b1c] shadow-2xl shadow-black/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <span className="text-[13px] font-semibold text-white">Pick an Emoji</span>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#585658] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Picker */}
        <Picker
          theme={Theme.DARK}
          onEmojiClick={handleEmojiClick}
          autoFocusSearch
          lazyLoadEmojis
          skinTonesDisabled={false}
          width={350}
          height={400}
          previewConfig={{ showPreview: false }}
          searchPlaceHolder="Search emoji..."
          style={{
            // Override the library's default background so it blends with our dark chrome
            "--epr-bg-color": "#1c1b1c",
            "--epr-category-label-bg-color": "#1c1b1c",
            "--epr-hover-bg-color": "rgba(255,255,255,0.06)",
            "--epr-highlight-color": "#5e4ae3",
            "--epr-search-input-bg-color": "#0f0f10",
            "--epr-text-color": "#c8c4d7",
            "--epr-category-icon-active-color": "#7c3aed",
            "--epr-search-input-text-color": "#ffffff",
            "--epr-search-input-placeholder-color": "#585658",
            "--epr-search-border-color": "rgba(255,255,255,0.08)",
            "--epr-picker-border-color": "transparent",
            "--epr-emoji-size": "28px",
            "--epr-category-navigation-button-size": "22px",
          } as React.CSSProperties}
        />

        {/* Clear button */}
        {value && onClear ? (
          <div className="border-t border-white/[0.06] px-4 py-2.5">
            <button
              type="button"
              onClick={() => {
                onClear();
                onClose();
              }}
              className="w-full rounded-lg border border-white/[0.06] py-1.5 text-[11px] font-medium text-[#918f90] transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              Clear emoji
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
