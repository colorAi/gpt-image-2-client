export function FestivalButtonDragonHead() {
  return (
    <span className="festival-button-dragon-head" aria-hidden="true" />
  );
}

export function FestivalButtonDragonTail() {
  return (
    <span className="festival-button-dragon-tail" aria-hidden="true" />
  );
}

export function FestivalBackdrop() {
  return (
    <svg className="festival-backdrop" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="mistMountain" x1="0" y1="260" x2="0" y2="880" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8DC7A1" stopOpacity=".14" />
          <stop offset="1" stopColor="#4A9971" stopOpacity=".29" />
        </linearGradient>
        <linearGradient id="mistMountainNear" x1="0" y1="390" x2="0" y2="940" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9DD3AD" stopOpacity=".16" />
          <stop offset="1" stopColor="#3F916A" stopOpacity=".34" />
        </linearGradient>
        <linearGradient id="waterMist" x1="800" y1="720" x2="800" y2="1000" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A5DCCB" stopOpacity="0" />
          <stop offset="1" stopColor="#65BBA7" stopOpacity=".28" />
        </linearGradient>
      </defs>

      <circle cx="1325" cy="165" r="58" fill="#E7BD63" opacity=".08" />
      <path d="M0 790 150 548l115 142 177-333 174 293 102-153 176 280v223H0V790Z" fill="url(#mistMountain)" />
      <path d="m555 1000 184-366 125 151 187-378 201 349 117-187 231 301v130H555Z" fill="url(#mistMountainNear)" />
      <path d="M0 790c205-48 384-35 564 13 196 52 381 54 573-6 175-54 329-55 463-16v219H0V790Z" fill="url(#waterMist)" />

      <g fill="none" stroke="#4F9E6B" strokeLinecap="round" opacity=".18">
        <path d="M1280-20c-28 114-78 218-168 310" strokeWidth="8" />
        <path d="M1330-30c-26 137-72 261-154 372" strokeWidth="5" />
      </g>
      <g fill="#4C9D68" opacity=".13">
        <path d="M1256 42c-76 2-115 34-124 91 67-8 108-36 124-91Z" />
        <path d="M1214 127c-68 6-101 36-106 88 60-11 94-38 106-88Z" />
        <path d="M1360 52c-66 4-98 34-101 84 58-10 90-36 101-84Z" />
        <path d="M1320 147c-58 4-86 29-90 74 51-8 80-32 90-74Z" />
        <path d="M1157 231c-50 3-75 25-79 64 44-7 69-28 79-64Z" />
      </g>

      <g fill="#589F70" opacity=".1">
        <path d="M66 110c66-1 100 27 108 78-59-6-94-32-108-78Z" />
        <path d="M25 48c61 0 94 25 103 71-55-5-89-28-103-71Z" />
        <path d="M145 36c56 2 84 27 89 69-49-7-78-29-89-69Z" />
      </g>
      <g fill="none" stroke="#52956B" strokeWidth="3" opacity=".1">
        <path d="M-10 3c80 42 142 101 192 180" />
        <path d="M59 0c56 42 100 91 134 148" />
      </g>

      <g fill="none" stroke="#65B09B" strokeLinecap="round" opacity=".11">
        <path d="M60 862c220-70 435-66 645 12s430 79 676-1" strokeWidth="3" />
        <path d="M0 908c228-55 440-43 637 35s448 77 761-13" strokeWidth="5" />
        <path d="M175 963c194-37 377-19 550 35" strokeWidth="2" />
      </g>
    </svg>
  );
}

export function FestivalRailSeal() {
  return <span className="festival-rail-tag festival-rail-seal" aria-hidden="true">端午</span>;
}

export function FestivalDragonBoatRail() {
  return (
    <div className="festival-rail-scene" aria-hidden="true">
      <span className="festival-rail-tag">端午</span>
      <svg className="festival-rail-svg" viewBox="0 0 72 560" preserveAspectRatio="xMidYMax meet">
        <defs>
          <linearGradient id="railWater" x1="36" y1="40" x2="36" y2="560" gradientUnits="userSpaceOnUse">
            <stop stopColor="#EAF6E9" stopOpacity=".05" />
            <stop offset=".5" stopColor="#A9DFD0" stopOpacity=".5" />
            <stop offset="1" stopColor="#39A7A0" stopOpacity=".92" />
          </linearGradient>
          <linearGradient id="boatHull" x1="25" y1="142" x2="47" y2="548" gradientUnits="userSpaceOnUse">
            <stop stopColor="#159658" />
            <stop offset=".48" stopColor="#087746" />
            <stop offset="1" stopColor="#075538" />
          </linearGradient>
          <linearGradient id="boatDeck" x1="36" y1="180" x2="36" y2="525" gradientUnits="userSpaceOnUse">
            <stop stopColor="#127F49" />
            <stop offset="1" stopColor="#06472F" />
          </linearGradient>
          <filter id="railShadow" x="-50%" y="-20%" width="200%" height="160%">
            <feDropShadow dx="0" dy="5" stdDeviation="3" floodColor="#174F3B" floodOpacity=".22" />
          </filter>
        </defs>

        <path d="M0 180c12-10 18-11 30-3S54 187 72 173v387H0V180Z" fill="url(#railWater)" />
        <g fill="none" stroke="#F8FFFA" strokeLinecap="round">
          <path d="M2 305c11-12 20-11 31 0s22 13 37-2" strokeWidth="4" opacity=".72" />
          <path d="M0 331c13-11 23-8 34 2s21 10 38-5" strokeWidth="2.6" opacity=".62" />
          <path d="M3 402c10-9 18-9 29 0s23 12 38-2" strokeWidth="3.2" opacity=".68" />
          <path d="M0 459c13-13 24-10 34 1s23 10 38-5" strokeWidth="4.5" opacity=".72" />
          <path d="M2 518c11-10 20-9 31 1s23 10 38-3" strokeWidth="3" opacity=".72" />
        </g>

        <g filter="url(#railShadow)">
          <path
            d="M36 126c-5 0-7 5-7 13v31c0 13-3 23-9 34l-4 9 7-3c-5 27-6 65-5 109l5 190c.4 18 6 34 13 43 7-9 12.6-25 13-43l5-190c1-44 0-82-5-109l7 3-4-9c-6-11-9-21-9-34v-31c0-8-2-13-7-13Z"
            fill="url(#boatHull)"
            stroke="#D9B45B"
            strokeWidth="1.5"
          />
          <path d="M36 139v399" stroke="#45B86E" strokeWidth="2" opacity=".75" />
          <path d="M24 215c-3 34-3 68-2 104l5 189c.3 11 4 24 9 32 5-8 8.7-21 9-32l5-189c1-36 1-70-2-104l-12-18-12 18Z" fill="url(#boatDeck)" opacity=".95" />
          <path d="M25 216c7 5 15 5 22 0" fill="none" stroke="#70C889" strokeWidth="1.5" opacity=".8" />

          <g fill="none" stroke="#F2AD39" strokeWidth="4" strokeLinecap="round">
            <path d="M30 163c-2 18-7 32-15 40-2 2-4 1-3-3" />
            <path d="M42 163c2 18 7 32 15 40 2 2 4 1 3-3" />
            <path d="M27 168c-1 14-4 24-9 31" opacity=".78" />
            <path d="M45 168c1 14 4 24 9 31" opacity=".78" />
          </g>
          <path d="M29 139c5 3 9 3 14 0" fill="none" stroke="#06452E" strokeWidth="3" strokeLinecap="round" />

          {[247, 302, 357, 412, 467].map((y, index) => (
            <g key={y}>
              <path d={`M23 ${y - 3}h12v24H20c0-11 1-18 3-24ZM49 ${y - 3}H37v24h15c0-11-1-18-3-24Z`} fill={index % 2 ? "#F0F4E9" : "#FFFFFF"} />
              <circle cx="29" cy={y} r="6.2" fill="#24312D" />
              <circle cx="43" cy={y} r="6.2" fill="#24312D" />
              <path d={`M24 ${y + 7} 10 ${y + 22}M48 ${y + 7} 62 ${y + 22}`} fill="none" stroke="#B17C50" strokeWidth="3.2" strokeLinecap="round" />
              <path d={`M9 ${y + 22}l-5 11M63 ${y + 22}l5 11`} fill="none" stroke="#9B633D" strokeWidth="5" strokeLinecap="round" />
              <path d={`M22 ${y + 20}h28`} stroke="#D2A65B" strokeWidth="1.5" opacity=".75" />
            </g>
          ))}
          <path d="M36 538c-7 7-9 14-7 22l7-5 7 5c2-8 0-15-7-22Z" fill="#0D7948" stroke="#D9B45B" strokeWidth="1.2" />
        </g>

        <g fill="none" stroke="#F7FFFB" strokeLinecap="round">
          <path d="M9 215c-7 13-7 27 0 40M63 215c7 13 7 27 0 40" strokeWidth="3" opacity=".86" />
          <path d="M7 270c-6 12-6 24 0 37M65 270c6 12 6 24 0 37" strokeWidth="2.5" opacity=".72" />
          <path d="M8 493c-6 11-6 23 0 35M64 493c6 11 6 23 0 35" strokeWidth="3" opacity=".78" />
        </g>
      </svg>
    </div>
  );
}
