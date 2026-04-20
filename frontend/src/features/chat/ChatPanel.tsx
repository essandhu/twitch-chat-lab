import { ChatList } from './ChatList';
import { FilterToolbar } from '../filters/FilterToolbar';
import { PinnedMessageRibbon } from './PinnedMessageRibbon';
import { useChatStore } from '../../store/chatStore';

export function ChatPanel() {
  const filterState = useChatStore((s) => s.filterState);
  const setFilterState = useChatStore((s) => s.setFilterState);

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-2 py-1">
        <FilterToolbar
          filterState={filterState}
          onFilterStateChange={(next) => setFilterState(next)}
        />
      </div>
      <PinnedMessageRibbon />
      <div className="flex-1 min-h-0">
        <ChatList />
      </div>
    </div>
  );
}
