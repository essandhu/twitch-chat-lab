type ScrollToBottomProps = {
  visible: boolean;
  onClick: () => void;
};

export function ScrollToBottom({ visible, onClick }: ScrollToBottomProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Scroll to latest message"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-surface-raised border border-border px-3 py-1.5 text-xs font-mono uppercase tracking-[0.2em] text-text shadow-lg shadow-black/40 transition-colors duration-150 hover:bg-surface-hover hover:border-accent hover:text-accent"
    >
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" />
      </svg>
      Jump to latest
    </button>
  );
}
