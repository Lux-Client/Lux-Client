import React from 'react';
import { cn } from '../../lib/utils';

function EmptyState({ icon: Icon, title, description, action, className }: { icon?: any; title: any; description?: any; action?: any; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-8 text-center', className)}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4 ring-1 ring-border/50">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground mb-1.5 text-balance">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm text-pretty">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;
