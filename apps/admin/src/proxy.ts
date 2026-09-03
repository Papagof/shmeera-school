import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session on every request and redirects
// unauthenticated users away from the dashboard to /login. This runs before
// any page code — actual data access is still governed entirely by RLS
// (SPEC.md §3.1), this is just UX routing.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // /accept-invite establishes its session client-side only, from a URL
  // hash fragment (#access_token=...) that Supabase's invite-link redirect
  // attaches — fragments are never sent to the server, so this proxy has no
  // way to see that session at request time. Without treating it as public
  // the same as /login, every invite link redirected straight back to
  // /login before the page's own JS ever ran (found live).
  const isPublicPath = request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/accept-invite";
  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  if (user && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
