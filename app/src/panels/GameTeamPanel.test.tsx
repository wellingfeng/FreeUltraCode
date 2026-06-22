import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameTeamPanel from './GameTeamPanel';
import {
  DEFAULT_GAME_EXPERT_SETTINGS,
  normalizeGameExpertSettings,
} from '@/lib/gameExperts';
import { useStore } from '@/store/useStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as typeof ResizeObserver;

async function renderGameTeamPanel(node: ReactNode = <GameTeamPanel />): Promise<{
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
}> {
  useStore.setState({
    locale: 'zh-CN',
    composerDraft: '',
    composerDrafts: {},
    gameExpertSettings: normalizeGameExpertSettings({
      ...DEFAULT_GAME_EXPERT_SETTINGS,
      enabled: true,
    }),
  });

  const container = document.createElement('div');
  container.style.height = '760px';
  container.style.width = '440px';
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

afterEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('GameTeamPanel', () => {
  it('renders a navigable blueprint organization canvas', async () => {
    const onOpenDetails = vi.fn();
    const view = await renderGameTeamPanel(
      <GameTeamPanel mode="organization" onOpenDetails={onOpenDetails} />,
    );

    try {
      expect(view.container.querySelector('[aria-label="专家视角蓝图"]')).not.toBeNull();
      expect(view.container.textContent).not.toContain('组织架构');
      expect(view.container.textContent).toContain('制作人');
      expect(view.container.textContent).toContain('直属总监');
      expect(view.container.textContent).toContain('玩法策划');
      expect(view.container.textContent).toContain('视角');
      expect(view.container.querySelectorAll('svg').length).toBeGreaterThan(8);

      const locateTechnicalDirector = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="定位 技术总监"]',
      );
      expect(locateTechnicalDirector).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        locateTechnicalDirector?.click();
      });

      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'technical-director',
      );

      const locateClientDevelopment = view.container.querySelector<HTMLButtonElement>(
        '[aria-label="定位 客户端开发"]',
      );
      expect(locateClientDevelopment).toBeInstanceOf(HTMLButtonElement);
      expect(
        view.container.querySelector('[aria-label="定位 引擎开发"]'),
      ).toBeInstanceOf(HTMLButtonElement);
      expect(
        view.container.querySelector('[aria-label="定位 技术美术"]'),
      ).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        locateClientDevelopment?.click();
      });

      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'client-development',
      );
      expect(
        view.container.querySelector('[aria-label="定位 引擎开发"]'),
      ).toBeInstanceOf(HTMLButtonElement);

      const searchInput = view.container.querySelector<HTMLInputElement>(
        'input[aria-label="搜索组织岗位"]',
      );
      expect(searchInput).toBeInstanceOf(HTMLInputElement);

      await act(async () => {
        setInputValue(searchInput!, '技术总监');
      });

      const searchResult = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('技术总监'));
      expect(searchResult).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        searchResult?.click();
      });

      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'technical-director',
      );

      const technicalDirector = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('技术总监'));
      expect(technicalDirector).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        technicalDirector?.click();
      });

      expect(onOpenDetails).toHaveBeenCalledWith('technical-director');
      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'technical-director',
      );

      await act(async () => {
        technicalDirector?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      });

      expect(onOpenDetails).toHaveBeenCalledWith('technical-director');
    } finally {
      await view.cleanup();
    }
  });

  it('opens details when React Flow itself receives the node pointer press', async () => {
    const onOpenDetails = vi.fn();
    const view = await renderGameTeamPanel(
      <GameTeamPanel mode="organization" onOpenDetails={onOpenDetails} />,
    );

    try {
      const producerWrapper = view.container.querySelector<HTMLElement>(
        '.react-flow__node[data-id="producer"]',
      );
      expect(producerWrapper).toBeInstanceOf(HTMLElement);

      await act(async () => {
        producerWrapper?.dispatchEvent(
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
          }),
        );
      });

      expect(onOpenDetails).toHaveBeenCalledWith('producer');
      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'producer',
      );
    } finally {
      await view.cleanup();
    }
  });

  it('renders team role details and inserts skill slash commands', async () => {
    window.localStorage.setItem(
      'ultragamestudio.gameTeam.selectedNode.v1',
      'technical-director',
    );
    const view = await renderGameTeamPanel();

    try {
      expect(view.container.textContent).toContain('技术总监');
      expect(view.container.textContent).not.toContain('组织架构');
      expect(view.container.querySelector('[role="tree"]')).toBeNull();

      expect(view.container.textContent).toContain('绑定关系');
      expect(view.container.textContent).toContain('视角绑定 Skill');
      expect(view.container.textContent).toContain('Skill 关联视角');
      expect(view.container.textContent).toContain('被其它视角参考');
      expect(view.container.textContent).toContain('下级视角');
      expect(view.container.textContent).toContain('发起功能开发');
      expect(view.container.textContent).toContain('客户端开发');
      expect(view.container.textContent).not.toContain('任务匹配');
      expect(view.container.textContent).not.toContain('插入多岗位方案');
      expect(view.container.textContent).not.toContain('保存执行方案');
      expect(view.container.textContent).not.toContain('标准化检查');

      const featureSkill = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.includes('发起功能开发'));
      expect(featureSkill).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        featureSkill?.click();
      });

      expect(useStore.getState().composerDraft).toContain('/technical-director');
      expect(useStore.getState().composerDraft).toContain('发起功能开发');

      const childRole = Array.from(
        view.container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent?.trim() === '客户端开发');
      expect(childRole).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        childRole?.click();
      });

      expect(window.localStorage.getItem('ultragamestudio.gameTeam.selectedNode.v1')).toBe(
        'client-development',
      );
      expect(view.container.textContent).toContain('客户端开发');
    } finally {
      await view.cleanup();
    }
  });

  it('lets users add, edit, and delete org nodes and skills', async () => {
    const view = await renderGameTeamPanel();

    try {
      const buttons = () =>
        Array.from(view.container.querySelectorAll<HTMLButtonElement>('button'));
      const inputs = () =>
        Array.from(view.container.querySelectorAll<HTMLInputElement>('input'));
      const textareas = () =>
        Array.from(view.container.querySelectorAll<HTMLTextAreaElement>('textarea'));

      const addNode = buttons().find(
        (button) => button.getAttribute('aria-label') === '添加下级视角',
      );
      expect(addNode).toBeInstanceOf(HTMLButtonElement);

      await act(async () => {
        addNode?.click();
      });

      const nodeId = inputs().find((input) => input.value.includes('-role'));
      const nodeLabel = inputs().find((input) => input.value === '新岗位');
      expect(nodeId).toBeInstanceOf(HTMLInputElement);
      expect(nodeLabel).toBeInstanceOf(HTMLInputElement);

      await act(async () => {
        setInputValue(nodeId!, 'custom-role');
        setInputValue(nodeLabel!, '自定义岗位');
      });

      const nodeSummary = textareas().find((textarea) =>
        textarea.placeholder.includes('职责摘要'),
      );
      const nodeRole = textareas().find((textarea) =>
        textarea.placeholder.includes('职责说明'),
      );
      const nodePosition = textareas().find((textarea) =>
        textarea.placeholder.includes('组织中的定位'),
      );
      const nodeResponsibilities = textareas().find((textarea) =>
        textarea.placeholder.includes('每行一条核心职责'),
      );
      const nodeScenarios = textareas().find((textarea) =>
        textarea.placeholder.includes('每行一个适用任务场景'),
      );
      const nodeDeliverables = textareas().find((textarea) =>
        textarea.placeholder.includes('每行一个交付物'),
      );
      const nodeCollaborators = textareas().find((textarea) =>
        textarea.placeholder.includes('每行一个相关岗位'),
      );
      expect(nodeSummary).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodeRole).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodePosition).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodeResponsibilities).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodeScenarios).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodeDeliverables).toBeInstanceOf(HTMLTextAreaElement);
      expect(nodeCollaborators).toBeInstanceOf(HTMLTextAreaElement);

      await act(async () => {
        setInputValue(nodeSummary!, '自定义岗位摘要。');
        setInputValue(nodeRole!, '自定义岗位职责说明。');
        setInputValue(nodePosition!, '负责把任务转成可执行产物。');
        setInputValue(nodeResponsibilities!, '拆解任务\n确认边界');
        setInputValue(nodeScenarios!, '新需求进入团队时');
        setInputValue(nodeDeliverables!, '任务拆解表\n验收清单');
        setInputValue(nodeCollaborators!, '制作人\n技术总监');
      });

      const saveNode = buttons().find((button) => button.textContent?.includes('保存'));
      await act(async () => {
        saveNode?.click();
      });

      expect(view.container.textContent).toContain('自定义岗位');
      expect(view.container.textContent).not.toContain('标准化检查');
      expect(view.container.textContent).toContain('负责把任务转成可执行产物。');
      expect(view.container.textContent).toContain('拆解任务');
      expect(view.container.textContent).toContain('新需求进入团队时');
      expect(view.container.textContent).toContain('任务拆解表');
      expect(view.container.textContent).toContain('制作人');
      const savedDefinition = JSON.parse(
        window.localStorage.getItem('ultragamestudio.gameOrgDefinition.v1') ?? '{}',
      );
      const savedCustomRole = savedDefinition.children?.find(
        (child: { id?: string }) => child.id === 'custom-role',
      );
      expect(savedCustomRole?.profile).toMatchObject({
        position: '负责把任务转成可执行产物。',
        responsibilities: ['拆解任务', '确认边界'],
        scenarios: ['新需求进入团队时'],
        deliverables: ['任务拆解表', '验收清单'],
        collaborators: ['制作人', '技术总监'],
      });

      const addSkill = buttons().find(
        (button) => button.getAttribute('aria-label') === '新增 Skill',
      );
      await act(async () => {
        addSkill?.click();
      });

      const skillInputs = inputs();
      const skillId = skillInputs.find((input) => input.value.includes(':skill'));
      const skillLabel = skillInputs.find((input) => input.value === '新 Skill');
      expect(skillId).toBeInstanceOf(HTMLInputElement);
      expect(skillLabel).toBeInstanceOf(HTMLInputElement);

      await act(async () => {
        setInputValue(skillId!, 'custom-skill');
        setInputValue(skillLabel!, '自定义 Skill');
      });

      const skillPrompt = textareas().find((textarea) =>
        textarea.placeholder.includes('插入输入框'),
      );
      expect(skillPrompt).toBeInstanceOf(HTMLTextAreaElement);
      await act(async () => {
        setInputValue(skillPrompt!, '执行自定义 Skill。');
      });

      const triggerConditions = textareas().find((textarea) =>
        textarea.placeholder.includes('什么情况应该参考'),
      );
      const inputsField = textareas().find((textarea) =>
        textarea.placeholder.includes('需要用户需求'),
      );
      const stepsField = textareas().find((textarea) =>
        textarea.placeholder.includes('每行一个建议步骤'),
      );
      const outputsField = textareas().find((textarea) =>
        textarea.placeholder.includes('方案、代码变更'),
      );
      const acceptanceField = textareas().find((textarea) =>
        textarea.placeholder.includes('怎样判断'),
      );
      expect(triggerConditions).toBeInstanceOf(HTMLTextAreaElement);
      expect(inputsField).toBeInstanceOf(HTMLTextAreaElement);
      expect(stepsField).toBeInstanceOf(HTMLTextAreaElement);
      expect(outputsField).toBeInstanceOf(HTMLTextAreaElement);
      expect(acceptanceField).toBeInstanceOf(HTMLTextAreaElement);

      await act(async () => {
        setInputValue(triggerConditions!, '用户需要自定义岗位能力。');
        setInputValue(inputsField!, '需求和当前项目上下文。');
        setInputValue(stepsField!, '确认目标\n拆解任务\n输出方案');
        setInputValue(outputsField!, '自定义执行方案。');
        setInputValue(acceptanceField!, '方案可执行且可验收。');
      });

      const saveSkill = buttons().find(
        (button) => button.textContent?.trim() === '保存',
      );
      await act(async () => {
        saveSkill?.click();
      });

      expect(view.container.textContent).toContain('自定义 Skill');

      const savedSkill = buttons().find((button) =>
        button.textContent?.includes('自定义 Skill'),
      );
      expect(savedSkill).toBeInstanceOf(HTMLButtonElement);
      await act(async () => {
        savedSkill?.click();
      });
      expect(useStore.getState().composerDraft).toContain('Skill 标准六项');
      expect(useStore.getState().composerDraft).toContain(
        '触发条件：用户需要自定义岗位能力。',
      );
      expect(useStore.getState().composerDraft).toContain(
        '验收标准：方案可执行且可验收。',
      );

      const editSkill = buttons().find(
        (button) => button.getAttribute('aria-label') === '编辑 自定义 Skill',
      );
      await act(async () => {
        editSkill?.click();
      });

      const editSkillLabel = inputs().find((input) => input.value === '自定义 Skill');
      expect(editSkillLabel).toBeInstanceOf(HTMLInputElement);
      await act(async () => {
        setInputValue(editSkillLabel!, '重命名 Skill');
      });

      const saveEditedSkill = buttons().find(
        (button) => button.textContent?.trim() === '保存',
      );
      await act(async () => {
        saveEditedSkill?.click();
      });

      expect(view.container.textContent).toContain('重命名 Skill');

      const deleteSkill = buttons().find(
        (button) => button.getAttribute('aria-label') === '删除 重命名 Skill',
      );
      await act(async () => {
        deleteSkill?.click();
      });

      expect(view.container.textContent).not.toContain('重命名 Skill');
      expect(view.container.textContent).toContain('暂无 Skill');

      const deleteNode = buttons().find(
        (button) => button.getAttribute('aria-label') === '删除岗位',
      );
      await act(async () => {
        deleteNode?.click();
      });

      expect(view.container.textContent).not.toContain('自定义岗位');
    } finally {
      await view.cleanup();
    }
  });
});
