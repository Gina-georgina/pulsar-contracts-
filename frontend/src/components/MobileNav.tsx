import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface MobileNavItem {
  /** Visible label for the navigation item. */
  label: string;
  /** Destination URL. */
  href: string;
  /** Optional click handler (e.g. for client-side routing). */
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  /** Marks the item as the current page for assistive technology. */
  current?: boolean;
}

export interface MobileNavProps {
  /** Navigation items to render. */
  items: MobileNavItem[];
  /** Accessible name for the nav landmark. Defaults to "Main". */
  ariaLabel?: string;
  /** Optional brand/title rendered at the start of the bar. */
  brand?: React.ReactNode;
  /** Optional extra content rendered at the end of the bar (desktop). */
  children?: React.ReactNode;
  /** Breakpoint in px below which the hamburger is shown. Defaults to 768. */
  breakpoint?: number;
  /** Optional class name for the outer wrapper. */
  className?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Responsive navigation component.
 *
 * - Renders a horizontal nav at >= breakpoint (default 768px).
 * - Renders a hamburger button below the breakpoint that opens a drawer.
 * - Traps focus inside the open drawer, closes on Escape or outside click,
 *   and restores focus to the hamburger button on close.
 */
const MobileNav: React.FC<MobileNavProps> = ({
  items,
  ariaLabel = 'Main',
  brand,
  children,
  breakpoint = 768,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
  });

  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const drawerId = useId();
  const hamburgerId = useId();

  // Track viewport size so we can switch between desktop/mobile layouts.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(event.matches);
    };
    handleChange(mql);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }
    // Safari < 14 fallback
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, [breakpoint]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) {
      // Restore focus to the element that opened the menu (hamburger).
      const target = previouslyFocusedRef.current ?? hamburgerRef.current;
      if (target && typeof target.focus === 'function') {
        // Defer to allow the drawer to unmount first.
        window.setTimeout(() => target.focus(), 0);
      }
    }
  }, []);

  const openMenu = useCallback(() => {
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? hamburgerRef.current;
    setIsOpen(true);
  }, []);

  const toggleMenu = useCallback(() => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }, [isOpen, closeMenu, openMenu]);

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (!isOpen || !drawerRef.current) {
      return;
    }
    const drawer = drawerRef.current;
    const focusables = drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables[0] ?? drawer;
    // Defer to ensure the drawer is painted.
    const id = window.setTimeout(() => first.focus(), 0);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // Close the drawer if the viewport grows past the breakpoint.
  useEffect(() => {
    if (!isMobile && isOpen) {
      closeMenu(false);
    }
  }, [isMobile, isOpen, closeMenu]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  // Handle Escape, focus trap, and outside click.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMenu();
        return;
      }

      if (event.key !== 'Tab' || !drawerRef.current) {
        return;
      }

      const drawer = drawerRef.current;
      const focusables = Array.from(
        drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (el) =>
          !el.hasAttribute('disabled') &&
          el.getAttribute('aria-hidden') !== 'true' &&
          (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
      );

      if (focusables.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || active === drawer || !drawer.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !drawer.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (drawerRef.current && drawerRef.current.contains(target)) {
        return;
      }
      if (hamburgerRef.current && hamburgerRef.current.contains(target)) {
        // Let the button's own handler toggle the state.
        return;
      }
      closeMenu();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [isOpen, closeMenu]);

  const handleItemClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    item: MobileNavItem,
  ) => {
    if (item.onClick) {
      item.onClick(event);
    }
    // Close the drawer after navigating (only in mobile mode).
    if (isMobile) {
      closeMenu(false);
    }
  };

  const renderItems = (variant: 'desktop' | 'mobile') =>
    items.map((item, index) => (
      <li key={`${variant}-${item.href}-${index}`} className="mobile-nav__item">
        <a
          href={item.href}
          className="mobile-nav__link"
          aria-current={item.current ? 'page' : undefined}
          onClick={(event) => handleItemClick(event, item)}
        >
          {item.label}
        </a>
      </li>
    ));

  return (
    <div className={`mobile-nav ${className ?? ''}`.trim()}>
      <style>{`
        .mobile-nav {
          position: relative;
          width: 100%;
          font-family: inherit;
        }
        .mobile-nav__bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 0.5rem 1rem;
        }
        .mobile-nav__brand {
          display: flex;
          align-items: center;
          font-weight: 600;
        }
        .mobile-nav__desktop {
          display: none;
        }
        .mobile-nav__desktop-list {
          display: flex;
          align-items: center;
          gap: 1rem;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .mobile-nav__item {
          margin: 0;
        }
        .mobile-nav__link {
          display: inline-block;
          padding: 0.5rem 0.75rem;
          color: inherit;
          text-decoration: none;
          border-radius: 4px;
        }
        .mobile-nav__link:hover {
          text-decoration: underline;
        }
        .mobile-nav__link:focus-visible,
        .mobile-nav__hamburger:focus-visible,
        .mobile-nav__close:focus-visible {
          outline: 3px solid #1a73e8;
          outline-offset: 2px;
        }
        .mobile-nav__hamburger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          padding: 0;
          background: transparent;
          border: 1px solid currentColor;
          border-radius: 4px;
          color: inherit;
          cursor: pointer;
        }
        .mobile-nav__hamburger-icon {
          position: relative;
          display: block;
          width: 20px;
          height: 2px;
          background: currentColor;
        }
        .mobile-nav__hamburger-icon::before,
        .mobile-nav__hamburger-icon::after {
          content: '';
          position: absolute;
          left: 0;
          width: 20px;
          height: 2px;
          background: currentColor;
        }
        .mobile-nav__hamburger-icon::before {
          top: -6px;
        }
        .mobile-nav__hamburger-icon::after {
          top: 6px;
        }
        .mobile-nav__backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          z-index: 1000;
        }
        .mobile-nav__drawer {
          position: fixed;
          top: 0;
          right: 0;
          bottom: 0;
          width: min(320px, 85vw);
          max-width: 100%;
          background: #ffffff;
          color: #111111;
          box-shadow: -2px 0 8px rgba(0, 0, 0, 0.25);
          z-index: 1001;
          display: flex;
          flex-direction: column;
          padding: 1rem;
          overflow-y: auto;
        }
        .mobile-nav__drawer:focus {
          outline: none;
        }
        .mobile-nav__drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }
        .mobile-nav__drawer-title {
          font-weight: 600;
          font-size: 1rem;
        }
        .mobile-nav__close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          padding: 0;
          background: transparent;
          border: 1px solid currentColor;
          border-radius: 4px;
          color: inherit;
          cursor: pointer;
          font-size: 1.25rem;
          line-height: 1;
        }
        .mobile-nav__mobile-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .mobile-nav__mobile-list .mobile-nav__link {
          display: block;
          padding: 0.75rem;
          font-size: 1rem;
        }
        @media (min-width: ${breakpoint}px) {
          .mobile-nav__desktop {
            display: block;
          }
          .mobile-nav__hamburger {
            display: none;
          }
        }
        @media (prefers-reduced-motion: no-preference) {
          .mobile-nav__drawer {
            animation: mobile-nav-slide-in 200ms ease-out;
          }
          @keyframes mobile-nav-slide-in {
            from {
              transform: translateX(100%);
            }
            to {
              transform: translateX(0);
            }
          }
        }
      `}</style>

      <div className="mobile-nav__bar">
        {brand ? <div className="mobile-nav__brand">{brand}</div> : <span />}

        <nav
          className="mobile-nav__desktop"
          aria-label={ariaLabel}
        >
          <ul className="mobile-nav__desktop-list">{renderItems('desktop')}</ul>
        </nav>

        {children ? (
          <div className="mobile-nav__extra">{children}</div>
        ) : null}

        <button
          ref={hamburgerRef}
          id={hamburgerId}
          type="button"
          className="mobile-nav__hamburger"
          aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isOpen}
          aria-controls={drawerId}
          aria-haspopup="dialog"
          onClick={toggleMenu}
        >
          <span className="mobile-nav__hamburger-icon" aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <>
          <div className="mobile-nav__backdrop" aria-hidden="true" />
          <div
            ref={drawerRef}
            id={drawerId}
            className="mobile-nav__drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${ariaLabel} navigation`}
            tabIndex={-1}
          >
            <div className="mobile-nav__drawer-header">
              <span className="mobile-nav__drawer-title">{ariaLabel}</span>
              <button
                type="button"
                className="mobile-nav__close"
                aria-label="Close navigation menu"
                onClick={() => closeMenu()}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <nav aria-label={ariaLabel}>
              <ul className="mobile-nav__mobile-list">{renderItems('mobile')}</ul>
            </nav>
          </div>
        </>
      )}
    </div>
  );
};

export default MobileNav;