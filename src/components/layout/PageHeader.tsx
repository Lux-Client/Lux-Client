import React from 'react';
import { cn } from '../../lib/utils';

function PageHeader({ title, description, children, className }: { title: any; description?: any; children?: any; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between px-6 py-4 border-b border-stroke shrink-0', className)}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-foreground tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

export default PageHeader;
