import { NavLink } from 'react-router-dom';
import type { NavGroup, NavItem } from './Layout';
import { Icon } from './Icon';

export function TopNavigation({ groups, home }: { groups: NavGroup[]; home?: NavItem }) {
  const items = home ? [home, ...groups.flatMap((group) => group.items)] : groups.flatMap((group) => group.items);

  return (
    <nav className="topnav" aria-label="主導覽">
      <div className="topnav__items">
        {items.map((item) => (
          <NavLink
            className={({ isActive }) => `topnav__link${isActive ? ' active' : ''}`}
            data-focus-ring="outline"
            end={item.end}
            key={item.to}
            to={item.to}
          >
            <Icon name={item.icon} size={16} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
