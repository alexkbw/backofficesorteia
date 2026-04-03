import { useState, type FormEvent } from "react";
import { Loader2, LockKeyhole, ShieldAlert, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen() {
  const { signIn, resendSignupConfirmation, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    const errorMessage = await signIn(email, password);
    setIsSubmitting(false);

    if (errorMessage) {
      if (errorMessage === "Invalid login credentials") {
        toast.error("Login invalido ou email ainda nao confirmado. Confirme o link enviado pelo Supabase.");
      } else {
        toast.error(errorMessage);
      }
      return;
    }

    setPassword("");
  };

  const handleResendConfirmation = async () => {
    if (!email) {
      toast.error("Informe o email para reenviar a confirmacao.");
      return;
    }

    setIsResending(true);
    const errorMessage = await resendSignupConfirmation(email);
    setIsResending(false);

    if (errorMessage) {
      toast.error(errorMessage);
      return;
    }

    toast.success("Email de confirmacao reenviado.");
  };

  const isDisabled = isSubmitting || isLoading;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Trophy className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">SorteioPro Backoffice</CardTitle>
            <CardDescription>
              Entre com uma conta Supabase que tenha o papel <strong>admin</strong>.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@empresa.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isDisabled}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isDisabled}
                required
              />
            </div>

            <Button className="w-full" type="submit" disabled={isDisabled}>
              {isDisabled ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LockKeyhole className="mr-2 h-4 w-4" />
                  Entrar
                </>
              )}
            </Button>

            <Button
              className="w-full"
              type="button"
              variant="outline"
              onClick={handleResendConfirmation}
              disabled={isResending || isLoading}
            >
              {isResending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Reenviando...
                </>
              ) : (
                "Reenviar confirmacao"
              )}
            </Button>
          </form>

          <p className="mt-4 text-sm text-muted-foreground">
            Se a conta autenticar mas o painel nao abrir, confira se existe uma linha em{" "}
            <code>public.user_roles</code> com o papel <code>admin</code> para esse usuario.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function AccessDeniedScreen() {
  const { signOut, userEmail } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSignOut = async () => {
    setIsSubmitting(true);
    const errorMessage = await signOut();
    setIsSubmitting(false);

    if (errorMessage) {
      toast.error(errorMessage);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-lg border-border/60 shadow-lg">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl">Acesso negado</CardTitle>
            <CardDescription>
              A conta <strong>{userEmail ?? "autenticada"}</strong> nao possui permissao de admin.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            O banco esta com RLS habilitado e permite alteracoes do backoffice apenas para usuarios
            autenticados com o papel <code>admin</code> na tabela <code>public.user_roles</code>.
          </p>

          <Button className="w-full" variant="outline" onClick={handleSignOut} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saindo...
              </>
            ) : (
              "Trocar de conta"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
