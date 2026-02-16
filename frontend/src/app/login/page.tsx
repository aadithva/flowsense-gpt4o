import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

function resolveSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveErrorMessage(errorCode?: string): string {
  if (!errorCode) return '';

  switch (errorCode) {
    case 'invalid_state':
      return 'Sign-in verification failed. Please try again.';
    case 'token_exchange':
      return 'Could not complete Entra sign-in. Check app credentials and redirect URI.';
    case 'auth_failed':
      return 'Authentication was cancelled or denied.';
    default:
      return 'Sign-in failed. Please retry.';
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextPath = resolveSearchParam(resolvedSearchParams, 'next') || '/';
  const errorCode = resolveSearchParam(resolvedSearchParams, 'error');
  const errorMessage = resolveErrorMessage(errorCode);

  const loginHref = `/api/auth/login?next=${encodeURIComponent(nextPath)}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-900 to-black">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-3xl font-bold text-center">
            FlowSense
          </CardTitle>
          <CardDescription className="text-center">
            Secure sign-in with Microsoft Entra ID
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full">
            <a href={loginHref}>Sign In With Microsoft</a>
          </Button>

          {errorMessage && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
