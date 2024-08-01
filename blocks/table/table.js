export default async function decorate(block) {
  // TODO: allow for dynamic table creation
  const table = block.querySelector('table');
  const body = table.querySelector('tbody');
  const bodyCells = body.querySelectorAll('tr > td');
  bodyCells.forEach((cell) => {
    // style empty cells
    const text = cell.textContent.trim();
    if (!text || text === '') cell.textContent = '-';
  });
}
