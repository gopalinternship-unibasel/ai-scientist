import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserMenu } from "./UserMenu";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

const renderMenu = () =>
  render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>,
  );

describe("UserMenu", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("shows a loading skeleton while auth is resolving", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, signOut: vi.fn() });
    const { container } = renderMenu();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows a sign-in link when no user is present", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });
    renderMenu();
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the user's name and an avatar initial when signed in", () => {
    mockUseAuth.mockReturnValue({
      user: {
        email: "ada@example.com",
        user_metadata: { full_name: "Ada Lovelace" },
      },
      loading: false,
      signOut: vi.fn(),
    });
    renderMenu();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("falls back to the email when no full name is set", () => {
    mockUseAuth.mockReturnValue({
      user: { email: "grace@example.com", user_metadata: {} },
      loading: false,
      signOut: vi.fn(),
    });
    renderMenu();
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });
});
