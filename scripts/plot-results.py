"""English measured figures for the final report. Reads saved results only."""
from pathlib import Path
import json,argparse
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Rebuild English figures from an audited saved study; no inference.')
parser.add_argument('--out',type=Path,default=ROOT/'artifacts/figures')
parser.add_argument('--study',type=Path,default=ROOT/'results/retained-plans-2026-10-24')
args=parser.parse_args()
STUDY=args.study.resolve()
OUT=args.out.resolve();OUT.mkdir(parents=True,exist_ok=True)
data=json.loads((STUDY/'analysis.json').read_text(encoding='utf-8'))
assert data['audit']['verifiedRows']==288 and not data['audit']['partial']
models=['qwen3.5:4b','qwen3.5:9b-q4_K_M']
arms=['whole_none','whole_feedback','local_none','local_feedback','whole_random','local_random']
labels=['Whole\nno\nreport','Whole\nwith\nfeedback','Local\nno\nreport','Local\nwith\nfeedback','Random\nwhole\nplan','Random\nlocal\nsection']
colors=['#6185a4','#168f86','#6185a4','#168f86','#b18b50','#b18b50']
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':9,'axes.spines.top':False,'axes.spines.right':False,'savefig.facecolor':'white'})
def save(fig,name):
    for ext in ['png','svg','pdf']:fig.savefig(OUT/(name+'.'+ext),dpi=280,bbox_inches='tight',pad_inches=.12)
    plt.close(fig)

fig,axes=plt.subplots(1,2,figsize=(9,3.9),sharey=True)
for ax,model,title in zip(axes,models,['Qwen3.5 4B','Qwen3.5 9B']):
    cells=[next(x for x in data['summary'] if x['model']==model and x['arm']==arm) for arm in arms]
    first=[x['initialPassed'] for x in cells];gain=[x['recovered'] for x in cells]
    ax.bar(range(6),first,color='#cad2db',width=.7)
    bars=ax.bar(range(6),gain,bottom=first,color=colors,width=.7)
    for bar,item in zip(bars,cells):ax.text(bar.get_x()+bar.get_width()/2,item['successes']+.45,str(item['successes'])+'/24',ha='center',fontsize=9,fontweight='bold')
    ax.set_xticks(range(6),labels,fontsize=8);ax.set_ylim(0,26);ax.set_yticks(range(0,25,4));ax.set_title(title,fontsize=12,pad=10)
    ax.grid(axis='y',color='#e1e6eb');ax.set_axisbelow(True)
axes[0].set_ylabel('Complete proxy successes')
fig.subplots_adjust(bottom=.25,wspace=.12)
save(fig,'results-en')

fig,ax=plt.subplots(figsize=(7.7,2.7))
cells=[next(x for x in data['summary'] if x['model']==models[1] and x['arm']==arm) for arm in ['local_none','local_feedback','local_random']]
for i,(cell,label,color)in enumerate(zip(cells,['No diagnostic report','Measured feedback','Random local repair'],['#6185a4','#168f86','#b18b50'])):
    recovered=cell['recovered'];failed=cell['initiallyFailed']-recovered
    ax.barh(i,recovered,color=color,height=.58);ax.barh(i,failed,left=recovered,color='#e0e6ec',height=.58)
    ax.text(recovered+.2,i,f'{recovered}/21 recovered',va='center',fontsize=10,fontweight='bold',color='#173b4a')
ax.set_yticks(range(3),['No diagnostic report','Measured feedback','Random local repair']);ax.invert_yaxis()
ax.set_xlim(0,22);ax.set_xticks([0,3,6,9,12,15,18,21]);ax.set_xlabel('Initially failing cases after up to three repair proposals')
ax.set_title('Qwen 9B local repair excludes the three shared initial successes',fontsize=11,pad=12)
ax.spines['left'].set_visible(False);ax.tick_params(axis='y',length=0);fig.tight_layout()
save(fig,'recovery-en')

rows=[json.loads(line) for line in (STUDY/'runs.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
families=['intro','blocks','spikes','stairs','dense','gauntlet']
fig,axes=plt.subplots(1,2,figsize=(9,4.1),sharey=True)
for ax,model,title in zip(axes,models,['Qwen3.5 4B','Qwen3.5 9B']):
    values=[[sum(bool(r['result']['passed']) for r in rows if r['model']==model and r['family']==family and r['arm']==arm) for arm in arms] for family in families]
    ax.imshow(values,vmin=0,vmax=4,cmap='Blues',aspect='auto')
    for y,row in enumerate(values):
        for x,value in enumerate(row):ax.text(x,y,f'{value}/4',ha='center',va='center',color='white' if value>=3 else '#173b4a',fontweight='bold',fontsize=9)
    ax.set_xticks(range(6),labels,fontsize=7.5);ax.set_yticks(range(6),['Intro','Blocks','Spikes','Stairs','Dense','Gauntlet']);ax.set_title(title,fontsize=12,pad=10)
    for spine in ax.spines.values():spine.set_visible(False)
    ax.tick_params(length=0)
fig.subplots_adjust(bottom=.25,wspace=.12)
save(fig,'families-en')

fig,ax=plt.subplots(figsize=(9,2.3));ax.set_xlim(0,10);ax.set_ylim(0,2.3);ax.axis('off')
boxes=[(.1,'Qwen','Plan or local edit'),(2.1,'Compiler','Literal geometry'),(4.1,'Verifier','Search and rules'),(6.1,'Guard','Retain or reject'),(8.1,'Outcome','Pass: stop/export')]
for x,title,description in boxes:
    patch=FancyBboxPatch((x,1.05),1.65,.88,boxstyle='round,pad=.06,rounding_size=.08',linewidth=1,edgecolor='#90a7b5',facecolor='#edf3f6')
    ax.add_patch(patch);ax.text(x+.825,1.6,title,ha='center',va='center',fontsize=11,fontweight='bold',color='#123c4b');ax.text(x+.825,1.29,description,ha='center',va='center',fontsize=8.5,color='#2b4a59')
for x in [.1,2.1,4.1,6.1]:ax.annotate('',xy=(x+1.99,1.49),xytext=(x+1.72,1.49),arrowprops={'arrowstyle':'->','color':'#436775','lw':1.2})
ax.plot([4.92,4.92,.92,.92],[.98,.4,.4,.98],color='#168f86',lw=1.2)
ax.annotate('',xy=(.92,1.02),xytext=(.92,.45),arrowprops={'arrowstyle':'->','color':'#168f86','lw':1.2})
ax.text(2.92,.56,'Measured report when enabled',ha='center',fontsize=9,color='#13776f')
ax.text(6.9,.56,'Retained state feeds the next proposal',ha='center',fontsize=8.5,color='#516a78')
ax.text(.1,2.15,'Brief and requirements enter Qwen; repair proposals share the same compiler and verifier.',fontsize=9,color='#334e5e')
save(fig,'architecture-en')
print('English figures generated from the complete frozen study without inference.')
