import { useState, useCallback, useRef, useEffect } from 'react';
import type { SplitNode } from '../contexts/TerminalContext';
import { TerminalPane } from './TerminalPane';

interface SplitContainerProps {
  node: SplitNode;
  tabId: string;
  focusedPaneId: string;
  isTabActive: boolean;
}

export function SplitContainer({ node, tabId, focusedPaneId, isTabActive }: SplitContainerProps) {
  if (node.type === 'pane') {
    return (
      <TerminalPane
        sessionId={node.sessionId}
        isFocused={focusedPaneId === node.sessionId && isTabActive}
        tabId={tabId}
      />
    );
  }

  return (
    <SplitView
      direction={node.direction}
      ratio={node.ratio}
      tabId={tabId}
      focusedPaneId={focusedPaneId}
      isTabActive={isTabActive}
      left={node.children[0]}
      right={node.children[1]}
    />
  );
}

interface SplitViewProps {
  direction: 'horizontal' | 'vertical';
  ratio: number;
  tabId: string;
  focusedPaneId: string;
  isTabActive: boolean;
  left: SplitNode;
  right: SplitNode;
}

function SplitView({ direction, ratio: initialRatio, tabId, focusedPaneId, isTabActive, left, right }: SplitViewProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    setRatio(initialRatio);
  }, [initialRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const container = containerRef.current;
    if (!container) return;

    const containerSize = direction === 'horizontal'
      ? container.getBoundingClientRect().width
      : container.getBoundingClientRect().height;

    const startRatio = ratio;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
      const delta = (currentPos - startPos) / containerSize;
      const newRatio = Math.min(0.8, Math.max(0.2, startRatio + delta));
      setRatio(newRatio);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      window.dispatchEvent(new Event('split-resize'));
    };

    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [direction, ratio]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full ${isHorizontal ? 'flex-row' : 'flex-col'}`}
    >
      <div
        style={isHorizontal
          ? { width: `${ratio * 100}%`, minWidth: '80px' }
          : { height: `${ratio * 100}%`, minHeight: '60px' }
        }
        className="relative overflow-hidden"
      >
        <SplitContainer
          node={left}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
          isTabActive={isTabActive}
        />
      </div>

      <div
        onMouseDown={handleMouseDown}
        className={`flex-shrink-0 ${
          isHorizontal
            ? 'w-1 cursor-col-resize hover:bg-[#7aa2f7]/50'
            : 'h-1 cursor-row-resize hover:bg-[#7aa2f7]/50'
        } bg-[#292e42] transition-colors`}
      />

      <div
        style={isHorizontal
          ? { width: `${(1 - ratio) * 100}%`, minWidth: '80px' }
          : { height: `${(1 - ratio) * 100}%`, minHeight: '60px' }
        }
        className="relative overflow-hidden"
      >
        <SplitContainer
          node={right}
          tabId={tabId}
          focusedPaneId={focusedPaneId}
          isTabActive={isTabActive}
        />
      </div>
    </div>
  );
}
