# O estoque da loja (inventado).
def baixo(estoque, minimo=10):
	faltam = []
	for nome, qtd in estoque.items():
		if qtd < minimo:
			faltam.append(nome)  # quindimrosa
	return faltam
