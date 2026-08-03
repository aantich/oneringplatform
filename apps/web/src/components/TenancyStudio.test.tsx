import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserAppDetail } from '../types';
import { TenancyStudio } from './TenancyStudio';

const detail = {
  app: { id: 'app', tenancyMode: 'multi_organization', tenancyRevision: 1 },
  tenancy: { id: 't1', appId: 'app', revision: 1, mode: 'multi_organization', organizationLabel: 'Organization', allowMultipleMemberships: true, status: 'published', createdBy: 'system', createdAt: 'now' },
  tenancyRevisions: [],
  endTenants: [{ id: 'northwind', appId: 'app', slug: 'northwind', name: 'Northwind', status: 'active', createdAt: 'now' }],
  memberships: [{ id: 'm1', appId: 'app', userId: 'u1', email: 'admin@example.com', displayName: 'Ada Admin', tenantId: 'northwind', roles: ['admin'], status: 'active', version: 1, createdAt: 'now', updatedAt: 'now' }],
  tenancyMigrations: [],
  releases: [{ id: 'r1', version: '0.1.1.1', status: 'active' }],
} as unknown as BrowserAppDetail;

describe('TenancyStudio', () => {
  it('presents all application audience contracts and explains the selected boundary', () => {
    render(<TenancyStudio detail={detail} onDetail={vi.fn()} onNotice={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('button', { name: /personal app/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /team app/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /multi-organization/i })).toBeInTheDocument();
    expect(screen.getAllByText('Northwind').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /personal app/i }));
    expect(screen.getByText('One private owner')).toBeInTheDocument();
    expect(screen.queryByText('Users and access')).not.toBeInTheDocument();
  });
});
