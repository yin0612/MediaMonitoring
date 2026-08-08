import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { NavGroup, NavItem } from './Layout';
import { Icon, type IconName } from './Icon';

function MobileTab({ to, label, icon, end }: NavItem) {
  return (
    <NavLink
      className={({ isActive }) => `mobile-tab${isActive ? ' active' : ''}`}
      end={end}
      to={to}
    >
      <Icon name={icon} size={21} />
      <span>{label}</span>
    </NavLink>
  );
}

export function MobileNavigation({ groups, home }: { groups: NavGroup[]; home: NavItem }) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const search = groups[0]?.items[0];
  const overview = groups[1]?.items[0];

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;

    const mobileQuery = window.matchMedia('(max-width: 1100px)');
    const closeOutsideMobile = (event: MediaQueryListEvent) => {
      if (!event.matches) setOpen(false);
    };
    mobileQuery.addEventListener('change', closeOutsideMobile);
    return () => mobileQuery.removeEventListener('change', closeOutsideMobile);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : moreRef.current;
    const previousOverflow = document.body.style.overflow;
    const backgroundNodes = Array.from(document.querySelectorAll<HTMLElement>('.appbar, .layout, .mobile-tabbar'));
    const backgroundState = backgroundNodes.map((node) => ({
      node,
      inert: node.getAttribute('inert'),
      ariaHidden: node.getAttribute('aria-hidden'),
    }));

    document.body.style.overflow = 'hidden';
    backgroundNodes.forEach((node) => {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    });
    closeRef.current?.focus();

    const manageDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', manageDialogKeys);
    return () => {
      document.body.style.overflow = previousOverflow;
      backgroundState.forEach(({ node, inert, ariaHidden }) => {
        if (inert === null) node.removeAttribute('inert');
        else node.setAttribute('inert', inert);
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      window.removeEventListener('keydown', manageDialogKeys);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  const primary: NavItem[] = [
    { ...home, label: '首頁', icon: 'home' as IconName },
    ...(search ? [{ ...search, label: '搜尋' }] : []),
    ...(overview ? [{ ...overview, label: '總覽' }] : []),
  ];

  return (
    <>
      <nav className="mobile-tabbar" aria-label="行動版主導覽">
        {primary.map((item) => <MobileTab key={item.to} {...item} />)}
        <button
          ref={moreRef}
          className={`mobile-tab${open ? ' active' : ''}`}
          type="button"
          aria-label="更多"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={21} />
          <span>更多</span>
        </button>
      </nav>

      {open && (
        <div className="mobile-sheet-layer">
          <button
            className="mobile-sheet__backdrop"
            type="button"
            aria-label="關閉選單背景"
            onClick={() => setOpen(false)}
          />
          <section
            ref={sheetRef}
            className="mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-sheet-title"
          >
            <header className="mobile-sheet__header">
              <div>
                <span className="eyebrow">導覽</span>
                <h2 id="mobile-sheet-title">所有功能</h2>
              </div>
              <button
                ref={closeRef}
                className="iconbtn"
                type="button"
                aria-label="關閉功能選單"
                onClick={() => setOpen(false)}
              >
                <Icon name="close" size={20} />
              </button>
            </header>

            <NavLink className="mobile-sheet__home" to={home.to} end onClick={() => setOpen(false)}>
              <span className="mobile-sheet__item-icon"><Icon name="home" size={20} /></span>
              <span>{home.label}</span>
              <Icon name="chevronRight" size={17} />
            </NavLink>

            {groups.map((group) => (
              <section className="mobile-sheet__group" key={group.label} aria-labelledby={`mobile-group-${group.label}`}>
                <h3 id={`mobile-group-${group.label}`}>{group.label}</h3>
                {group.items.map((item) => (
                  <NavLink className="mobile-sheet__link" to={item.to} key={item.to} onClick={() => setOpen(false)}>
                    <span className="mobile-sheet__item-icon"><Icon name={item.icon} size={20} /></span>
                    <span>{item.label}</span>
                    <Icon name="chevronRight" size={17} />
                  </NavLink>
                ))}
              </section>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
