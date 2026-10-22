import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const LINKS = [
  { href: '/om', label: 'Om' },
  { href: '/kontakt', label: 'Kontakt' },
  { href: '/privatlivspolitik', label: 'Privatlivspolitik' },
] as const;

export default function SiteNavMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Menu"
          className="shadow-none data-[state=open]:bg-accent [&_svg]:size-5"
        >
          <Menu aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={14}
        className="min-w-48 rounded-lg border-border bg-white p-0 py-1 text-foreground shadow-md"
      >
        {LINKS.map((link) => (
          <DropdownMenuItem
            key={link.href}
            asChild
            className="cursor-pointer rounded-none px-4 py-2 text-sm text-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <a href={link.href} className="no-underline">
              {link.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
