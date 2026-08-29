import React from 'react';
import { cn } from '../../lib/utils';

function PageHeader({ title, description, children, className }: { title: any; description?: any; children?: any; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between px-5 lg:px-8 py-4 lg:py-5 border-b border-border/60 shrink-0 bg-background/30 backdrop-blur-sm', className)}>
      <div className="min-w-0">
        <h1 className="text-lg lg:text-xl font-semibold text-foreground tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5 text-pretty">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

export default PageHeader;
