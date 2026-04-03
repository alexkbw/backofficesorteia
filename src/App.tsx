import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AdminLayout from "@/components/AdminLayout";
import { AccessDeniedScreen, LoginScreen } from "@/components/AuthScreen";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import Dashboard from "@/pages/Dashboard";
import Draws from "@/pages/Draws";
import Payments from "@/pages/Payments";
import Promotions from "@/pages/Promotions";
import Chat from "@/pages/Chat";
import Participants from "@/pages/Participants";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout><Dashboard /></AdminLayout>} />
        <Route path="/sorteios" element={<AdminLayout><Draws /></AdminLayout>} />
        <Route path="/pagamentos" element={<AdminLayout><Payments /></AdminLayout>} />
        <Route path="/promocoes" element={<AdminLayout><Promotions /></AdminLayout>} />
        <Route path="/chat" element={<AdminLayout><Chat /></AdminLayout>} />
        <Route path="/participantes" element={<AdminLayout><Participants /></AdminLayout>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function AppContent() {
  const { session, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 text-sm text-muted-foreground">
        Verificando acesso ao backoffice...
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!isAdmin) {
    return <AccessDeniedScreen />;
  }

  return <AppRoutes />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <AppContent />
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
