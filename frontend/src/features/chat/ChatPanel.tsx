import { ChatList } from './ChatList';
import { FilterToolbar } from '../filters/FilterToolbar';

export function ChatPanel() {
  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-ink-800 px-2 py-1">
        <FilterToolbar />
      </div>
      <div className="flex-1 min-h-0">
        <ChatList />
      </div>
    </div>
  );
}
