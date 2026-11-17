// A janela Notas (T2121: o conteúdo está em NotesApp.tsx, que o hub também monta).
import { mount } from "../src/kit/index.tsx";
import { NotesApp } from "./NotesApp.tsx";

document.title = "Notas";
mount(<NotesApp />);
