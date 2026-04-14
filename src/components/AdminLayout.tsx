import { ReactNode, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Trophy,
  CreditCard,
  Megaphone,
  MessageCircle,
  Users,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/sorteios", label: "Sorteios", icon: Trophy },
  { path: "/pagamentos", label: "Pagamentos", icon: CreditCard },
  { path: "/promocoes", label: "Promoções", icon: Megaphone },
  { path: "/chat", label: "Chat", icon: MessageCircle },
  { path: "/participantes", label: "Participantes", icon: Users },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { userEmail, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    const errorMessage = await signOut();
    setIsSigningOut(false);

    if (errorMessage) {
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 flex-shrink-0 bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Trophy className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <h1 className="text-base font-bold text-sidebar-accent-foreground">Poster Premiado</h1>
              <p className="text-xs text-sidebar-foreground/60">Backoffice</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3 px-3">
            <p className="text-xs text-sidebar-foreground/60">Conectado como</p>
            <p className="break-all text-sm font-medium text-sidebar-accent-foreground">
              {userEmail ?? "Conta admin"}
            </p>
          </div>

          <Button
            className="w-full justify-start"
            variant="ghost"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            <LogOut className="w-4 h-4" />
            {isSigningOut ? "Saindo..." : "Sair"}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-background overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
