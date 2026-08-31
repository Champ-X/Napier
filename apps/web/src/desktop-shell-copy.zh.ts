export const desktopShellCopyZh = {
  workspaceSurface: {
    section: "工作区",
    sectionDescription: "此运行时所操作的本地文件夹",
    currentRoot: "当前文件夹",
    dataRoot: "会话数据根目录",
    inputLabel: "切换到其他文件夹",
    placeholder: "/项目的绝对路径",
    submit: "切换文件夹",
    switching: "正在切换工作区……",
    warning:
      "切换后会在新文件夹上重建运行时，并显示该文件夹自己的会话。当前文件夹的会话会保留，切回时重新出现。运行进行中时不可切换。",
    chipLabel: "工作区",
  },
  welcome: {
    title: "今天想完成什么？",
    body: "描述目标即可。Napier 会把计划、操作与验证完整留存。",
    cue: "从常见任务开始",
    starters: {
      inspect: {
        title: "理解这个项目",
        body: "梳理结构、入口和关键风险",
        prompt: "检查当前工作区，梳理项目结构、主要入口和最值得关注的风险。",
      },
      build: {
        title: "实现一个功能",
        body: "规划、编码并完成验证",
        prompt:
          "帮我在当前项目中实现一个功能。请先理解现有结构，再提出聚焦的实施计划。",
      },
      debug: {
        title: "定位一个问题",
        body: "复现现象并确认根因",
        prompt:
          "帮我定位当前项目中的一个问题。先复现现象，确认根因，再提出并验证修复。",
      },
      review: {
        title: "评审当前改动",
        body: "检查正确性、风险与回归",
        prompt: "评审当前工作区的未提交改动，重点检查正确性、风险和测试覆盖。",
      },
      test: {
        title: "补全项目测试",
        body: "找出高价值缺口并补齐覆盖",
        prompt: "检查当前项目的测试体系，找出最有价值的缺口并补齐测试。",
      },
      plan: {
        title: "把目标变成计划",
        body: "明确步骤、验证标准与产物",
        prompt:
          "把我的目标整理成一份可执行计划，明确步骤、验证标准和最终产物。",
      },
    },
  },
  notices: {
    demo: "演示模型",
    demoDetail: "在服务端添加提供方密钥即可运行在线模型。",
    disconnected: "无法加载工作区。",
  },
  language: {
    section: "语言",
    sectionDescription: "界面显示语言",
    chinese: "中文",
    english: "English",
    current: "当前语言",
  },
} as const;
