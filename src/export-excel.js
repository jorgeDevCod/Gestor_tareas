/* ============================================================
   Exportación Excel con estilo (ExcelJS) — Tareas, Pagos,
   Festividades y Horarios. Lee los globales de app.js
   (tasks, reminders, labels y helpers). Sin dependencias extra.
   ============================================================ */
const EX = ( () => {
  function hexToArgb( hex, fallback = 'FF2563EB' ) {
    let h = String( hex || '' ).trim().replace( '#', '' );
    if ( /^[0-9a-fA-F]{3}$/.test( h ) ) {
      h = h.split( '' ).map( ( c ) => c + c ).join( '' );
    }
    if ( !/^[0-9a-fA-F]{6}$/.test( h ) ) return fallback;
    return 'FF' + h.toUpperCase();
  }

  // Nota: la fuente (Poppins/Open Sans) se aplica por nombre; Excel usa
  // la instalada en el equipo y alterna si no existe.
  function paint( cell, { bg = null, bold = false, color = 'FF1F2937', size = 11, hAlign = 'left', vAlign = 'middle', wrap = true, name = null } = {} ) {
    cell.font = { bold, color: { argb: color }, size };
    if ( name ) cell.font.name = name;
    if ( bg ) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb( bg ) } };
    }
    cell.alignment = { horizontal: hAlign, vertical: vAlign, wrapText: wrap };
    if ( hAlign === 'left' ) cell.alignment.indent = 1;
  }

  // Texto legible sobre cualquier fondo (misma regla que autoContrast en app)
  function textOn( hex ) {
    const n = [ 1, 3, 5 ].map( ( i ) => parseInt( String( hex || '' ).slice( i, i + 2 ), 16 ) || 0 );
    const lum = 0.2126 * n[ 0 ] + 0.7152 * n[ 1 ] + 0.0722 * n[ 2 ];
    return lum > 140 ? 'FF1F2937' : 'FFFFFFFF';
  }

  // Estilos resueltos desde la apariencia del wizard (colores/grosor/fuente
  // configurados por el usuario; nada hardcodeado aquí)
  function headStyle( style ) {    return { bg: style.header, bold: style.hbold !== false, color: hexToArgb( style.hcolor || '#ffffff' ), size: 11, hAlign: 'center', name: style.font || null };
  }
  function bodyStyle( style, hAlign = 'left' ) {
    return { bg: style.bg, bold: style.bbold === true, color: hexToArgb( style.bcolor || '#1f2937' ), size: 11, hAlign, name: style.font || null };
  }

  function borderAll( cell, color = 'FF000000' ) {
    const s = { style: 'thin', color: { argb: color } };
    cell.border = { top: s, left: s, bottom: s, right: s };
  }

  function outerBorder( ws, r1, c1, r2, c2, color = 'FF000000' ) {
    for ( let r = r1; r <= r2; r++ ) {
      for ( let c = c1; c <= c2; c++ ) {
        const cell = ws.getRow( r ).getCell( c );
        const b = cell.border || {};
        cell.border = {
          top: r === r1 ? { style: 'medium', color: { argb: color } } : ( b.top || {} ),
          bottom: r === r2 ? { style: 'medium', color: { argb: color } } : ( b.bottom || {} ),
          left: c === c1 ? { style: 'medium', color: { argb: color } } : ( b.left || {} ),
          right: c === c2 ? { style: 'medium', color: { argb: color } } : ( b.right || {} ),
        };
      }
    }
  }

  function colWidths( ws, widths ) {
    ws.columns = widths.map( ( w ) => ( { width: Math.min( 60, Math.max( 12, w ) ) } ) );
  }

  function measureRows( rows ) {
    const widths = [];
    rows.forEach( ( row ) => {
      row.forEach( ( v, i ) => {
        const len = String( v ?? '' ).split( '\n' ).reduce( ( m, l ) => Math.max( m, l.length ), 0 );
        widths[ i ] = Math.max( widths[ i ] || 0, len + 4 );
      } );
    } );
    return widths;
  }

  async function download( wb, filename ) {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob( [ buffer ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } );
    const a = document.createElement( 'a' );
    a.href = URL.createObjectURL( blob );
    a.download = filename;
    document.body.appendChild( a );
    a.click();
    setTimeout( () => {
      URL.revokeObjectURL( a.href );
      a.remove();
    }, 1000 );
  }

  function newWb() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Gestor de Tareas';
    return wb;
  }

  function fmtFecha( dateStr ) {
    const [ y, m, d ] = String( dateStr || '' ).split( '-' );
    return d && m && y ? `${d}/${m}/${y}` : ( dateStr || '' );
  }

  // ---------- TAREAS ----------
  async function tareas( style, opts = {} ) {
    const rows = [];
    Object.entries( tasks ).sort().forEach( ( [ date, dayTasks ] ) => {
      ( dayTasks || [] ).forEach( ( t ) => {
        if ( t.kind === 'horario' && !opts.incluirHorarios ) return;
        if ( !opts.incluirCompletadas && t.state === 'completed' ) return;
        const priority = ( PRIORITY_LEVELS[ t.priority ] || PRIORITY_LEVELS[ 3 ] ).label;
        const state = ( TASK_STATES[ t.state ] || TASK_STATES.pending ).label;
        rows.push( [ fmtFecha( date ), t.title, t.description || '', t.time || '', t.endTime || '', state, priority ] );
      } );
    } );
    if ( rows.length === 0 ) {
      showNotification( 'No hay tareas para exportar', 'info' );
      return false;
    }
    const header = [ 'Fecha', 'Título', 'Descripción', 'Hora de inicio', 'Hora de fin', 'Estado', 'Prioridad' ];
    const wb = newWb();
    const ws = wb.addWorksheet( 'Tareas' );
    ws.addRow( header );
    rows.forEach( ( r ) => ws.addRow( r ) );
    ws.eachRow( ( row, n ) => {
      row.height = n === 1 ? 24 : 20;
      row.eachCell( ( cell ) => {
        if ( n === 1 ) paint( cell, headStyle( style ) );
        else paint( cell, bodyStyle( style ) );
        if ( style.borders ) borderAll( cell );
      } );
    } );
    colWidths( ws, measureRows( [ header, ...rows ] ) );
    ws.views = [ { state: 'frozen', ySplit: 1 } ];
    await download( wb, `tareas_${getTodayString()}.xlsx` );
    return true;
  }

  // ---------- PAGOS (tablas lado a lado, 2 columnas de separación) ----------
  // custom: { pagoId: { title, headers: [h0,h1,h2] } } con valores efectivos
  async function pagos( style, ids, custom ) {
    const list = Object.values( reminders ).filter( ( r ) => r && r.kind === 'pago' && ( !ids || ids.includes( r.id ) ) );
    if ( list.length === 0 ) {
      showNotification( 'No hay pagos para exportar', 'info' );
      return false;
    }
    const viewOf = ( r ) => {
      const c = ( custom || {} )[ r.id ] || {};
      const hs = Array.isArray( c.headers ) ? c.headers : [];
      return {
        title: String( c.title || '' ).trim() || r.title,
        headers: [ hs[ 0 ]?.trim() || 'Fecha', hs[ 1 ]?.trim() || 'Descripción', hs[ 2 ]?.trim() || 'Monto' ],
      };
    };
    const wb = newWb();
    const ws = wb.addWorksheet( 'Pagos' );
    const withDesc = list.some( ( r ) => ( r.cuotas || [] ).some( ( c ) => ( r.description || '' ).trim() !== '' ) );
    const headers = withDesc ? [ 'Fecha', 'Descripción', 'Monto' ] : [ 'Fecha', 'Monto' ];
    const W = headers.length;
    const GAP = 2;

    let col = 1;
    let maxRow = 1;
    list.forEach( ( r ) => {
      const view = viewOf( r );
      const cuotas = [ ...( r.cuotas || [] ) ].sort( ( a, b ) => ( a.fecha < b.fecha ? -1 : 1 ) );
      let row = 1;
      // Título fusionado en la primera fila del grupo (fondo propio, no el de cabecera)
      ws.mergeCells( row, col, row, col + W - 1 );
      const titleCell = ws.getRow( row ).getCell( col );
      titleCell.value = r.title;
      paint( titleCell, { bg: style.titlebg || style.header, bold: style.hbold !== false, color: textOn( style.titlebg || style.header ), size: 13, hAlign: 'center', name: style.font || null } );
      if ( style.borders ) borderAll( titleCell );
      row++;
      // Cabecera (personalizable por tabla; respeta el ancho del grupo)
      view.headers.slice( 0, W ).forEach( ( h, i ) => {
        const cell = ws.getRow( row ).getCell( col + i );
        cell.value = h;
        paint( cell, headStyle( style ) );
        if ( style.borders ) borderAll( cell );
      } );
      ws.getRow( row ).height = 22;
      row++;
      // Filas (una por cuota, orden cronológico)
      cuotas.forEach( ( c ) => {
        const vals = withDesc
          ? [ fmtFecha( c.fecha ), `${c.etiqueta}${r.description ? ` — ${r.description}` : ''}`, Number( c.monto ) || 0 ]
          : [ fmtFecha( c.fecha ), Number( c.monto ) || 0 ];
        vals.forEach( ( v, i ) => {
          const cell = ws.getRow( row ).getCell( col + i );
          cell.value = v;
          const isMonto = ( withDesc && i === 2 ) || ( !withDesc && i === 1 );
          if ( isMonto && typeof v === 'number' ) cell.numFmt = '"S/"#,##0.00';
          paint( cell, bodyStyle( style, isMonto ? 'right' : 'left' ) );
          if ( style.borders ) borderAll( cell );
        } );
        ws.getRow( row ).height = 20;
        row++;
      } );
      if ( style.borders ) outerBorder( ws, 1, col, row - 1, col + W - 1 );
      maxRow = Math.max( maxRow, row - 1 );
      col += W + GAP;
    } );

    // Anchos por columna usada
    const widths = [];
    for ( let c = 1; c < col; c++ ) {
      let m = 14;
      for ( let r = 1; r <= maxRow; r++ ) {
        const v = ws.getRow( r ).getCell( c ).value;
        const len = String( v ?? '' ).split( '\n' ).reduce( ( x, l ) => Math.max( x, l.length ), 0 );
        m = Math.max( m, Math.min( 40, len + 4 ) );
      }
      widths.push( m );
    }
    colWidths( ws, widths );
    await download( wb, `pagos_${getTodayString()}.xlsx` );
    return true;
  }

  // ---------- FESTIVIDADES ----------
  async function festividades( style, ids ) {
    const list = Object.values( reminders ).filter( ( r ) => r && r.kind === 'festividad' && ( !ids || ids.includes( r.id ) ) );
    if ( list.length === 0 ) {
      showNotification( 'No hay festividades para exportar', 'info' );
      return false;
    }
    // Orden ascendente dentro del año (MM-DD)
    list.sort( ( a, b ) => {
      const ka = ( a.dates?.[ 0 ] || '' ).slice( 5 );
      const kb = ( b.dates?.[ 0 ] || '' ).slice( 5 );
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    } );
    const withDesc = list.some( ( r ) => ( r.description || '' ).trim() !== '' );
    const header = withDesc ? [ 'Título', 'Descripción', 'Fecha' ] : [ 'Título', 'Fecha' ];
    const rows = list.map( ( r ) => withDesc
      ? [ r.title, r.description || '', fmtFecha( r.dates?.[ 0 ] || '' ) ]
      : [ r.title, fmtFecha( r.dates?.[ 0 ] || '' ) ] );
    const wb = newWb();
    const ws = wb.addWorksheet( 'Festividades' );
    ws.addRow( header );
    rows.forEach( ( r ) => ws.addRow( r ) );
    const noteRow = ws.addRow( [ 'Nota:', '' ] );
    if ( !withDesc ) noteRow.getCell( 2 ).value = '';
    ws.mergeCells( noteRow.number, 1, noteRow.number, header.length );
    ws.eachRow( ( row, n ) => {
      row.height = n === 1 ? 24 : 22;
      row.eachCell( ( cell ) => {
        if ( n === 1 ) paint( cell, headStyle( style ) );
        else paint( cell, bodyStyle( style ) );
        if ( style.borders ) borderAll( cell );
      } );
    } );
    colWidths( ws, measureRows( [ header, ...rows, [ 'Nota:' ] ] ) );
    await download( wb, `festividades_${getTodayString()}.xlsx` );
    return true;
  }

  // ---------- HORARIOS (matriz semanal) ----------
  // Colector puro (testeable): agrupa por día de semana y bloque de 1h.
  // El MISMO recordatorio aparece UNA sola vez por celda aunque tenga
  // varias fechas el mismo día de semana (repeticiones semanales);
  // actividades DISTINTAS sí se apilan con '---'.
  function collectHorarioMatrix( list ) {
    const grid = {};
    let minH = 24, maxH = -1;
    const toMin = ( t ) => {
      const [ h, m ] = String( t || '0:0' ).split( ':' ).map( Number );
      return h * 60 + ( m || 0 );
    };
    ( list || [] ).forEach( ( r ) => {
      if ( !r ) return;
      ( r.dates || [] ).forEach( ( dateStr ) => {
        const wd = new Date( dateStr + 'T12:00:00' ).getDay(); // 0 Dom
        const startMin = toMin( r.inicio );
        const endMin = r.fin ? toMin( r.fin ) : startMin + 1;
        const firstBlock = Math.floor( startMin / 60 );
        // Bloques de 1h: ocupa h si h:00 < fin (11:00–12:30 → 11 y 12)
        for ( let h = firstBlock; h * 60 < Math.max( endMin, startMin + 1 ); h++ ) {
          minH = Math.min( minH, h );
          maxH = Math.max( maxH, h );
          const key = `${wd}|${h}`;
          const cell = ( grid[ key ] = grid[ key ] || [] );
          if ( !cell.some( ( e ) => e.id === r.id ) ) {
            cell.push( {
              id: r.id,
              text: `${r.title}\n${r.inicio || ''}${r.fin ? `–${r.fin}` : ''}`,
            } );
          }
        }
      } );
    } );
    return { grid, minH, maxH };
  }

  async function horarios( style, ids ) {
    const list = Object.values( reminders ).filter( ( r ) => r && r.kind === 'horario' && ( !ids || ids.includes( r.id ) ) );
    const { grid, minH, maxH } = collectHorarioMatrix( list );
    if ( maxH < 0 ) {
      showNotification( 'No hay horarios para exportar', 'info' );
      return false;
    }
    const days = [ 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo' ];
    const order = [ 1, 2, 3, 4, 5, 0, 6 ]; // Lun..Dom (getDay: 0 Dom)
    const header = [ 'Hora', ...days ];
    const wb = newWb();
    const ws = wb.addWorksheet( 'Horarios' );
    ws.addRow( header );
    for ( let h = minH; h <= maxH; h++ ) {
      const label = `${String( h ).padStart( 2, '0' )}:00`;
      const row = [ label ];
      order.forEach( ( wd ) => {
        const items = grid[ `${wd}|${h}` ] || [];
        row.push( items.map( ( e ) => e.text ).join( '\n---\n' ) );
      } );
      ws.addRow( row );
    }
    ws.eachRow( ( row, n ) => {
      const lines = Math.max( ...row.values.slice( 1 ).map( ( v ) => String( v ?? '' ).split( '\n' ).length ) );
      row.height = n === 1 ? 26 : Math.max( 45, lines * 15 );
      row.eachCell( ( cell, colNumber ) => {
        if ( n === 1 ) {
          paint( cell, headStyle( style ) );
        } else if ( colNumber === 1 ) {
          // Columna Hora: color de CUERPO (no de cabecera), en negrita como rótulo
          paint( cell, { ...bodyStyle( style, 'center' ), bold: true } );
        } else {
          paint( cell, { ...bodyStyle( style, 'center' ), vAlign: 'middle' } );
        }
        if ( style.borders ) borderAll( cell );
      } );
    } );
    const widths = [ 10 ];
    for ( let c = 2; c <= 8; c++ ) {
      let m = 16;
      ws.eachRow( ( row ) => {
        const v = row.getCell( c ).value;
        const len = String( v ?? '' ).split( '\n' ).reduce( ( x, l ) => Math.max( x, l.length ), 0 );
        m = Math.max( m, Math.min( 45, len + 4 ) );
      } );
      widths.push( m );
    }
    colWidths( ws, widths );
    ws.views = [ { state: 'frozen', xSplit: 1, ySplit: 1 } ];
    await download( wb, `horarios_${getTodayString()}.xlsx` );
    return true;
  }

  return { tareas, pagos, festividades, horarios, hexToArgb, collectHorarioMatrix };
} )();