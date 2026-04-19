import { ChatList } from './ChatList';
import { FilterToolbar } from '../filters/FilterToolbar';
import { PinnedMessageRibbon } from './PinnedMessageRibbon';

export function ChatPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-2 py-1">
        <FilterToolbar />
      </div>
      <PinnedMessageRibbon />
      <div className="flex-1 min-h-0">
        <ChatList />
      </div>
    </div>
  );
}
