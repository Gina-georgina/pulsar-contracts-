import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * MobileNav
 *
 * Responsive navigation for the dashboard.
 * - Renders the tab list horizontally at >= 768px.
 * - Collapses to a hamburger button below 768px.
 * - When open, renders a drawer/overlay with focus trapping, Escape-to-close,
 *   outside/backdrop click to close, and focus restoration to the hamburger.
 *
 * Props:
 * - tabs: Array<{ id: string, label: string, icon?: ReactNode }>
 * - activeTab: string (id of the active tab)
 * - onSelect: (id: string) => void
 * - ariaLabel?: string (optional accessible name for the nav landmark)
 */
const MOBILE_BREAKPOINT = 768;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true'
  );
}

export default function MobileNav({ tabs = [], activeTab, onSelect, ariaLabel = 'Dashboard navigation' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
  });

  const hamburgerRef = useRef(null);
  const drawerRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Track viewport size to decide between horizontal nav and hamburger.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handleChange = (event) => {
      setIsMobile(event.matches);
      if (!event.matches) {
        // Leaving mobile: ensure the drawer is closed.
        setIsOpen(false);
      }
    };

    setIsMobile(mql.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }

    // Safari < 14 fallback
    mql.addListener(handleChange);
    return () => mql.removeListener(handleChange);
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    if (restoreFocus) {
      const target = previouslyFocusedRef.current || hamburgerRef.current;
      if (target && typeof target.focus === 'function') {
        // Defer to allow the drawer to unmount first.
        window.setTimeout(() => target.focus(), 0);
      }
    }
  }, []);

  const openMenu = useCallback(() => {
    previouslyFocusedRef.current = document.activeElement;
    setIsOpen(true);
  }, []);

  const toggleMenu = useCallback(() => {
    if (isOpen) {
      closeMenu(true);
    } else {
      openMenu();
    }
  }, [isOpen, closeMenu, openMenu]);

  const handleSelect = useCallback(
    (id) => {
      if (typeof onSelect === 'function') {
        onSelect(id);
      }
      if (isMobile) {
        closeMenu(true);
      }
    },
    [onSelect, isMobile, closeMenu]
  );

  // When the drawer opens: move focus into it, lock body scroll.
  useEffect(() => {
    if (!isOpen) return undefined;

    const drawer = drawerRef.current;
    if (drawer) {
      const focusable = getFocusableElements(drawer);
      const first = focusable[0] || drawer;
      // Defer to ensure the drawer is mounted.
      window.setTimeout(() => {
        if (first && typeof first.focus === 'function') {
          first.focus();
        }
      }, 0);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Keyboard handling: Escape to close, Tab/Shift+Tab focus trap.
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Esc') {
        event.stopPropagation();
        closeMenu(true);
        return;
      }

      if (event.key !== 'Tab') return;

      const drawer = drawerRef.current;
      if (!drawer) return;

      const focusable = getFocusableElements(drawer);
      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !drawer.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !drawer.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closeMenu]);

  const handleBackdropClick = (event) => {
    // Only close when the backdrop itself is clicked, not the drawer content.
    if (event.target === event.currentTarget) {
      closeMenu(true);
    }
  };

  const renderTabList = (listClassName, itemClassName) => (
    <ul className={listClassName} role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <li key={tab.id} className={itemClassName} role="presentation">
            <button
              type="button"
              role="tab"
              id={`nav-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`nav-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`mobile-nav__tab${isActive ? ' mobile-nav__tab--active' : ''}`}
              onClick={() => handleSelect(tab.id)}
            >
              {tab.icon ? (
                <span className="mobile-nav__tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
              ) : null}
              <span className="mobile-nav__tab-label">{tab.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className="mobile-nav" aria-label={ariaLabel}>
      <style>{`
        .mobile-nav {
          position: relative;
          width: 100%;
        }

        .mobile-nav__desktop {
          display: none;
        }

        .mobile-nav__desktop-list {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .mobile-nav__tab {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 0.875rem;
          border: 1px solid transparent;
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          font: inherit;
          cursor: pointer;
          white-space: nowrap;
        }

        .mobile-nav__tab:hover {
          background: rgba(0, 0, 0, 0.06);
        }

        .mobile-nav__tab--active {
          background: rgba(0, 0, 0, 0.1);
          font-weight: 600;
        }

        .mobile-nav__tab:focus-visible,
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
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          cursor: pointer;
        }

        .mobile-nav__hamburger-icon {
          display: block;
          width: 22px;
          height: 2px;
          background: currentColor;
          position: relative;
        }

        .mobile-nav__hamburger-icon::before,
        .mobile-nav__hamburger-icon::after {
          content: '';
          position: absolute;
          left: 0;
          width: 22px;
          height: 2px;
          background: currentColor;
        }

        .mobile-nav__hamburger-icon::before {
          top: -7px;
        }

        .mobile-nav__hamburger-icon::after {
          top: 7px;
        }

        .mobile-nav__backdrop {
          position: fixed;
          inset: 0;
          z-index: 1000;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: flex-start;
        }

        .mobile-nav__drawer {
          width: min(320px, 85vw);
          max-width: 100%;
          height: 100%;
          background: #ffffff;
          color: #111111;
          box-shadow: 2px 0 12px rgba(0, 0, 0, 0.25);
          display: flex;
          flex-direction: column;
          padding: 1rem;
          overflow-y: auto;
          outline: none;
        }

        .mobile-nav__drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
        }

        .mobile-nav__drawer-title {
          font-size: 1rem;
          font-weight: 600;
          margin: 0;
        }

        .mobile-nav__close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          padding: 0;
          border: 1px solid rgba(0, 0, 0, 0.2);
          border-radius: 0.5rem;
          background: transparent;
          color: inherit;
          font-size: 1.25rem;
          line-height: 1;
          cursor: pointer;
        }

        .mobile-nav__drawer-list {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .mobile-nav__drawer-list .mobile-nav__tab {
          width: 100%;
          justify-content: flex-start;
          padding: 0.75rem 1rem;
        }

        @media (min-width: 768px) {
          .mobile-nav__desktop {
            display: block;
          }

          .mobile-nav__mobile {
            display: none;
          }
        }
      `}</style>

      {/* Desktop / wide-screen horizontal navigation */}
      <div className="mobile-nav__desktop">
        {renderTabList('mobile-nav__desktop-list', 'mobile-nav__desktop-item')}
      </div>

      {/* Mobile / narrow-screen hamburger + drawer */}
      <div className="mobile-nav__mobile">
        <button
          ref={hamburgerRef}
          type="button"
          className="mobile-nav__hamburger"
          aria-label={isOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isOpen}
          aria-controls="mobile-nav-drawer"
          aria-haspopup="dialog"
          onClick={toggleMenu}
        >
          <span className="mobile-nav__hamburger-icon" aria-hidden="true" />
        </button>

        {isOpen ? (
          <div
            className="mobile-nav__backdrop"
            onClick={handleBackdropClick}
            data-testid="mobile-nav-backdrop"
          >
            <div
              ref={drawerRef}
              id="mobile-nav-drawer"
              className="mobile-nav__drawer"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              tabIndex={-1}
            >
              <div className="mobile-nav__drawer-header">
                <h2 className="mobile-nav__drawer-title">Menu</h2>
                <button
                  type="button"
                  className="mobile-nav__close"
                  aria-label="Close navigation menu"
                  onClick={() => closeMenu(true)}
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>
              {renderTabList('mobile-nav__drawer-list', 'mobile-nav__drawer-item')}
            </div>
          </div>
        ) : null}
      </div>
    </nav>
  );
}