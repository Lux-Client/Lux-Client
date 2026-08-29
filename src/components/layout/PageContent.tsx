import React from 'react';
import { cn } from '../../lib/utils';
import { ScrollArea } from '../ui/scroll-area';

function PageContent({ children, className, noPadding = false, noScroll = false }: { children: any; className?: string; noPadding?: boolean; noScroll?: boolean }) {
  const content = (
    <div className={cn('flex-1 min-h-0', !noPadding && 'px-5 lg:px-8 py-5 lg:py-6', className)}>
      {children}
    </div>
  );

  if (noScroll) return content;

  return (
    <ScrollArea className="flex-1">
      {content}
    </ScrollArea>
  );
}

export default PageContent;
