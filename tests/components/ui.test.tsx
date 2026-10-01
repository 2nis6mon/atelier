import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Editable, domToMarkup } from '../../src/renderer/cv/Editable';
import { Confirm, Dialog } from '../../src/renderer/ui/Dialog';
import { LensTabs } from '../../src/renderer/ui/LensTabs';
import { MenuButton } from '../../src/renderer/ui/Menu';

describe('rich text editing', () => {
  it('turns pasted or typed formatting into Atelier markup', () => {
    const div = document.createElement('div');
    div.innerHTML = 'Je <b>conçois</b> des <span style="font-style: italic">interfaces</span>&nbsp;<strong><em>accessibles</em></strong><br>Ligne 2<div>Bloc</div>';
    expect(domToMarkup(div)).toBe('Je **conçois** des *interfaces* ***accessibles***\nLigne 2\nBloc');
    const heavy = document.createElement('div');
    heavy.innerHTML = '<span style="font-weight: 700">Gras</span> normal';
    expect(domToMarkup(heavy)).toBe('**Gras** normal');
  });

  it('emits edits, handles Enter and Backspace on an empty field, and keeps plain fields plain', () => {
    const onChange = vi.fn();
    const onEnter = vi.fn();
    const onBackspaceEmpty = vi.fn();
    render(<Editable value="Bonjour" path="bullet:b:i:x" editable onChange={onChange} onEnter={onEnter} onBackspaceEmpty={onBackspaceEmpty} ariaLabel="Bullet" />);
    const box = screen.getByRole('textbox', { name: 'Bullet' });
    expect(box).toHaveAttribute('contenteditable', 'true');
    box.innerHTML = 'Bonjour <b>à tous</b>';
    fireEvent.input(box);
    expect(onChange).toHaveBeenCalledWith('Bonjour **à tous**', 'bullet:b:i:x');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onEnter).toHaveBeenCalledWith('bullet:b:i:x');
    box.innerHTML = '';
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(onBackspaceEmpty).toHaveBeenCalledWith('bullet:b:i:x');
  });

  it('is read-only when not editable', () => {
    render(<Editable value="Texte" path="header.headline" editable={false} onChange={() => undefined} ariaLabel="Headline" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Texte')).toHaveAttribute('contenteditable', 'false');
  });
});

describe('lens tabs', () => {
  function Tabs({ role }: { role?: 'tab' | 'radio' }) {
    const [v, setV] = useState<'a' | 'b' | 'c'>('a');
    return <LensTabs label="Mode" role={role} value={v} onChange={setV} options={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }]} />;
  }

  it('is a tablist with one selected tab, moved by arrow keys, Home and End', () => {
    render(<Tabs />);
    const list = screen.getByRole('tablist', { name: 'Mode' });
    const tab = (n: string) => screen.getByRole('tab', { name: n });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Beta')).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'End' });
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'a' });
    expect(tab('Alpha')).toHaveAttribute('aria-selected', 'true');
  });

  it('can act as a radio group', async () => {
    render(<Tabs role="radio" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('dialogs and menus', () => {
  it('closes only the topmost dialog with Escape and keeps Tab inside it', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog title="Outer" onClose={outer}>
          <button type="button">First</button>
        </Dialog>
        <Dialog title="Inner" onClose={inner} footer={<button type="button">Last</button>}>
          <input aria-label="Name" />
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Inner' });
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    // focus trap
    screen.getByRole('button', { name: 'Last' }).focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('confirms or cancels destructive actions', async () => {
    const yes = vi.fn();
    const no = vi.fn();
    render(<Confirm title="Delete?" message="Gone forever." confirmLabel="Delete" danger onConfirm={yes} onCancel={no} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(yes).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(no).toHaveBeenCalled();
  });

  it('opens a menu from the keyboard, skips disabled items and closes with Escape', async () => {
    const open = vi.fn();
    const del = vi.fn();
    render(
      <MenuButton
        label="Actions"
        entries={[
          { label: 'Open', onSelect: open },
          { label: 'Locked', onSelect: () => undefined, disabled: true },
          { kind: 'separator' },
          { kind: 'label', label: 'Danger zone' },
          { label: 'Delete', onSelect: del, danger: true },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Actions' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(del).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(open).not.toHaveBeenCalled();
  });
});
