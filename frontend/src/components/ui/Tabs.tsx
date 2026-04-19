import * as RadixTabs from '@radix-ui/react-tabs'
import * as React from 'react'
import { cn } from '../../lib/cn'

type RootProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Root>
type ListProps = React.ComponentPropsWithoutRef<typeof RadixTabs.List>
type TriggerProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
type ContentProps = React.ComponentPropsWithoutRef<typeof RadixTabs.Content>

const TabsRoot = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Root>,
  RootProps
>(({ className, ...props }, ref) => (
  <RadixTabs.Root ref={ref} className={cn(className)} {...props} />
))
TabsRoot.displayName = 'Tabs.Root'

const TabsList = React.forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  ListProps
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn('flex border-b border-border', className)}
    {...props}
  />
))
TabsList.displayName = 'Tabs.List'

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  TriggerProps
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'px-4 py-2 text-sm text-text-muted data-[state=active]:text-text data-[state=active]:border-b-2 data-[state=active]:border-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = 'Tabs.Trigger'

const TabsContent = React.forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  ContentProps
>(({ className, ...props }, ref) => (
  <RadixTabs.Content ref={ref} className={cn('pt-4', className)} {...props} />
))
TabsContent.displayName = 'Tabs.Content'

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
}
