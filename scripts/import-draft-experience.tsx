import { createRoot } from 'react-dom/client';
import { EnglishImport } from '../src/english-import';
import '../src/style.css';
import '../src/parent.css';
import '../src/responsive.css';
import '../src/parent-preparation.css';
import '../src/parent-space.css';
import '../src/page-system.css';
import '../src/import-review.css';

createRoot(document.getElementById('root')!).render(<main className="parent-page parent-studio"><div style={{ maxWidth: 780, margin: '0 auto 20px', color: '#8b6b31', fontSize: 13, textAlign: 'center' }}>隔离工程验收 · 示例词表 · 无云调用 · 不影响正式数据</div><EnglishImport spellingEnabled={false} hasBooks={false} back={() => {}} packIds={['starter']} confirmed={async () => { throw Error('工程核对页不执行素材准备或交付'); }} /></main>);
