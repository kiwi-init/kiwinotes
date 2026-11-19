# O xlsx dos testes da planilha (T21107, spec #21065): o estoque de uma loja inventada, com tudo o que gravar não pode
# perder. Gera `estoque.xlsx` ao lado deste arquivo. Rode com `uv run --with openpyxl==3.1.5 make-estoque.py` e
# commite o resultado; o teste não depende do Python.
import os
from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.defined_name import DefinedName

wb = Workbook()
ws = wb.active
ws.title = "Estoque"
ws.append(["Produto", "Categoria", "Qtd", "Preço", "Total"])
itens = [
    ("Caneca azul", "Cozinha", 7, 24.9),
    ("Vaso de barro", "Jardim", 3, 58.0),
    ("Toalha listrada", "Banho", 12, 39.5),
    ("Regador", "Jardim", 5, 31.0),
    ("Pote de vidro", "Cozinha", 20, 12.75),
    ("Tapete redondo", "Banho", 2, 89.9),
]
for i, (p, c, q, v) in enumerate(itens, start=2):
    ws.append([p, c, q, v, f"=C{i}*D{i}"])
n = len(itens) + 1
ws.append(["Soma", None, f"=SUM(C2:C{n})", None, f"=SUM(E2:E{n})"])
# Cabeçalho colorido, largura, moeda, congelado, filtro, mescla.
for cell in ws[1]:
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="2F5597")
ws.column_dimensions["A"].width = 22
ws.column_dimensions["B"].width = 14
for r in range(2, n + 2):
    ws[f"D{r}"].number_format = '"R$" #,##0.00'
    ws[f"E{r}"].number_format = '"R$" #,##0.00'
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:E{n}"
ws.merge_cells(f"A{n + 1}:B{n + 1}")
# Formatação condicional: estoque baixo em vermelho. Validação: a quantidade é inteira e não negativa.
ws.conditional_formatting.add(f"C2:C{n}", CellIsRule(operator="lessThan", formula=["4"], fill=PatternFill("solid", fgColor="F8CBAD")))
dv = DataValidation(type="whole", operator="greaterThanOrEqual", formula1="0", allow_blank=True)
ws.add_data_validation(dv)
dv.add(f"C2:C{n}")
# O gráfico das quantidades, e um nome definido para a faixa.
chart = BarChart()
chart.title = "Quantidade por produto"
chart.add_data(Reference(ws, min_col=3, min_row=1, max_row=n), titles_from_data=True)
chart.set_categories(Reference(ws, min_col=1, min_row=2, max_row=n))
ws.add_chart(chart, "G2")
wb.defined_names["Quantidades"] = DefinedName("Quantidades", attr_text=f"Estoque!$C$2:$C${n}")
# Uma segunda aba que aponta para a primeira.
r = wb.create_sheet("Resumo")
r.append(["Itens em estoque", "=Estoque!C8"])
r.append(["Valor total", "=SUM(Estoque!E2:E7)"])
r["B2"].number_format = '"R$" #,##0.00'
# Uma tabela (revisão do T21107): o cabeçalho tem de bater com o `tableColumn`, e as referências estruturadas seguem o nome.
f = wb.create_sheet("Fornecedores")
f.append(["Fornecedor", "Cidade", "Prazo"])
for linha in [("Olaria Exemplo", "Cidade A", 10), ("Vidraria Modelo", "Cidade B", 7), ("Tecelagem Teste", "Cidade C", 15)]:
    f.append(list(linha))
f.add_table(Table(displayName="Fornecedores", ref="A1:C4", tableStyleInfo=TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)))
r.append(["Prazo médio", "=AVERAGE(Fornecedores[Prazo])"])
wb.defined_names["Prazos"] = DefinedName("Prazos", attr_text="Fornecedores[[#Data],[Prazo]]")
wb.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), "estoque.xlsx"))
