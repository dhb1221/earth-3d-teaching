# 贴图来源与授权

本项目的地球贴图来自 three.js 官方示例素材（examples/textures/planets/），
原始数据源为 NASA Visible Earth / Blue Marble 与 Earth at Night 系列（公有领域）。

| 文件 | 用途 | 分辨率 | 来源 |
|---|---|---|---|
| earth_day.jpg | 日间地表 | 2048×1024 | three.js examples ← NASA Blue Marble |
| earth_night.png | 夜间城市灯光 | 2048×1024 | three.js examples ← NASA Earth at Night |
| earth_normal.jpg | 地形法线 | 2048×1024 | three.js examples ← NASA 地形数据 |
| earth_specular.jpg | 海洋高光 | 2048×1024 | three.js examples |
| earth_clouds.png | 云层 | 1024×512 | three.js examples |

- 原始地址：https://threejs.org/examples/textures/planets/
- 授权：NASA 影像为公有领域（Public Domain），可自由用于教学与演示。
- 如需更高分辨率，可自行替换为 NASA Blue Marble 8k/21k 版本（同目录同名覆盖即可）。
- 星空背景由代码程序化生成，太阳由 shader 发光实现，二者均无外部素材依赖。
